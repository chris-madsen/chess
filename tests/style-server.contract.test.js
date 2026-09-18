import http from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChessJsRulesAdapter } from "../src/adapters/chessjs/chess-rules-adapter.ts";
import { makeRequestId } from "../src/domain/chess/value-objects.ts";
import { localStyleEngineProvider, maiaProvider } from "../src/domain/provenance/provenance.ts";
import { createStyleLineJobServer, readStyleServerToken } from "../src/server/style-server.ts";

const chess = createChessJsRulesAdapter();
const token = "test-token";

const rawBase64 = raw => Buffer.from(raw, "utf8").toString("base64");

const scriptedProvider = (source, provider, moveForRequest) => async request => {
  const move = moveForRequest(request);
  if (move instanceof Promise) {
    return move;
  }
  const parsed = chess.parseLegalMove(request.position, move);
  if (parsed.tag === "Err") return parsed;
  return {
    tag: "Ok",
    value: {
      move: parsed.value,
      provenance: {
        source,
        provider,
        status: source === "MAIA" ? "MODELED_LOCAL" : "ENGINE_GENERATED",
        requestId: makeRequestId(`${provider.name}-${request.ply}`),
        inputPositionHash: request.position.hash,
        configuration: {}
      }
    }
  };
};

const styleEngine = (key, displayName, moveForRequest) => ({
  key,
  source: "LOCAL_STYLE_ENGINE",
  identity: localStyleEngineProvider(key, displayName, "test"),
  configuration: { styleDepth: 14 },
  provideMove: scriptedProvider("LOCAL_STYLE_ENGINE", localStyleEngineProvider(key, displayName, "test"), moveForRequest),
  label: `${displayName} StylePath`
});

const providersFor = (moveForRequest, maiaMoveForRequest = () => "g1f3") => ({
  maia: scriptedProvider("MAIA", maiaProvider("test"), maiaMoveForRequest),
  styleEngines: [
    styleEngine("cstal-absurd-maia3", "CSTal ABSURD vs Maia3 79M", moveForRequest),
    styleEngine("cstal-extreme-maia3", "CSTal EXTREME vs Maia3 79M", moveForRequest)
  ]
});

const listen = async server => new Promise(resolve => {
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    resolve({ server, port: address.port });
  });
});

const close = async server => new Promise(resolve => server.close(resolve));

test("Style server reads the local token file when the environment token is absent", () => {
  const directory = mkdtempSync(join(tmpdir(), "chess-style-server-"));
  const tokenPath = join(directory, "style-server-token.txt");
  const previousToken = process.env.STYLE_SERVER_TOKEN;
  try {
    writeFileSync(tokenPath, "  local-test-token\n", "utf8");
    delete process.env.STYLE_SERVER_TOKEN;
    expect(readStyleServerToken(tokenPath)).toBe("local-test-token");
  } finally {
    if (previousToken === undefined) delete process.env.STYLE_SERVER_TOKEN;
    else process.env.STYLE_SERVER_TOKEN = previousToken;
    rmSync(directory, { recursive: true, force: true });
  }
});

const requestJson = async (port, method, path, body, auth = token, extraHeaders = {}) => new Promise((resolve, reject) => {
  const payload = body === undefined ? "" : JSON.stringify(body);
  const request = http.request({
    hostname: "127.0.0.1",
    port,
    path,
    method,
    headers: {
      ...(auth === null ? {} : { authorization: `Bearer ${auth}` }),
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload),
      ...extraHeaders
    }
  }, response => {
    const chunks = [];
    response.on("data", chunk => chunks.push(chunk));
    response.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      resolve({
        status: response.statusCode,
        body: text.trim().length === 0 ? undefined : JSON.parse(text)
      });
    });
  });
  request.on("error", reject);
  request.end(payload);
});

const collectSse = async (port, jobId, wantedTypes) => new Promise((resolve, reject) => {
  const events = [];
  const request = http.request({
    hostname: "127.0.0.1",
    port,
    path: `/v1/style-lines/jobs/${jobId}/events`,
    method: "GET",
    headers: { authorization: `Bearer ${token}` }
  }, response => {
    let buffer = "";
    response.on("data", chunk => {
      buffer += chunk.toString("utf8");
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const eventLine = frame.split("\n").find(line => line.startsWith("event: "));
        const dataLine = frame.split("\n").find(line => line.startsWith("data: "));
        if (eventLine === undefined || dataLine === undefined) continue;
        const event = {
          type: eventLine.slice("event: ".length),
          data: JSON.parse(dataLine.slice("data: ".length))
        };
        events.push(event);
        if (wantedTypes.every(type => events.some(item => item.type === type))) {
          request.destroy();
          resolve(events);
        }
      }
    });
    response.on("end", () => resolve(events));
  });
  request.on("error", error => {
    if (events.length > 0) {
      resolve(events);
      return;
    }
    reject(error);
  });
  request.end();
});

test("Style server rejects missing bearer token", async () => {
  const { server, port } = await listen(createStyleLineJobServer({ token }, { chess, createProviders: () => providersFor(() => "d8h4") }));
  try {
    const response = await requestJson(port, "POST", "/v1/style-lines/jobs", { rawGameBase64: rawBase64("1. f3 e5 2. g4") }, null);
    expect(response.status).toBe(401);
  } finally {
    await close(server);
  }
});

test("Style server rejects protected API requests outside allowed Cloudflare countries", async () => {
  const { server, port } = await listen(createStyleLineJobServer({ token, allowedCountries: ["EE"] }, { chess, createProviders: () => providersFor(() => "d8h4") }));
  try {
    const rejected = await requestJson(port, "POST", "/v1/style-lines/jobs", { rawGameBase64: rawBase64("1. f3 e5 2. g4") }, token, { "cf-ipcountry": "US" });
    expect(rejected.status).toBe(403);

    const accepted = await requestJson(port, "POST", "/v1/style-lines/jobs", { rawGameBase64: rawBase64("1. f3 e5 2. g4") }, token, { "cf-ipcountry": "EE" });
    expect(accepted.status).toBe(202);
  } finally {
    await close(server);
  }
});

test("Style server maps base64 raw game and CSTal params into provider factory", async () => {
  const seen = [];
  const { server, port } = await listen(createStyleLineJobServer({ token }, {
    chess,
    createProviders: (_chess, options) => {
      seen.push(options);
      return providersFor(() => "d8h4");
    }
  }));
  try {
    const created = await requestJson(port, "POST", "/v1/style-lines/jobs", {
      rawGameBase64: rawBase64("1. f3 e5 2. g4"),
      engineSuite: "cstal-windows",
      cstalOpponent: "maia3",
      maia3Elo: 2100,
      refreshMs: 250,
      maxFullMoves: 8,
      timeoutMs: 5000
    });
    expect(created.status).toBe(202);
    const events = await collectSse(port, created.body.jobId, ["complete"]);
    expect(seen).toEqual([{ opponent: "maia3", maia3Elo: 2100 }]);
    const complete = events.find(event => event.type === "complete");
    expect(complete.data.input.sideToMove).toBe("black");
    expect(complete.data.lines).toHaveLength(2);
    expect(complete.data.lines[0].sanMovetext).toContain("Qh4#");
  } finally {
    await close(server);
  }
});

test("Style server accepts a FEN job input for remote benchmark clients", async () => {
  const { server, port } = await listen(createStyleLineJobServer({ token }, {
    chess,
    createProviders: () => providersFor(() => "d8h4")
  }));
  try {
    const created = await requestJson(port, "POST", "/v1/style-lines/jobs", {
      fen: "rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2",
      engineSuite: "cstal-windows",
      maxFullMoves: 1,
      timeoutMs: 5000
    });
    expect(created.status).toBe(202);
    const events = await collectSse(port, created.body.jobId, ["complete"]);
    const complete = events.at(-1);
    expect(complete.data.input.sideToMove).toBe("black");
    expect(complete.data.lines[0].sanMovetext).toContain("Qh4#");
  } finally {
    await close(server);
  }
});

test("Style server cancels an unfinished job when a new job is posted", async () => {
  const never = new Promise(() => undefined);
  let providerBuilds = 0;
  const { server, port } = await listen(createStyleLineJobServer({ token }, {
    chess,
    createProviders: () => {
      providerBuilds += 1;
      const build = providerBuilds;
      return providersFor(() => build === 1 ? never : "d8h4");
    }
  }));
  try {
    const body = { rawGameBase64: rawBase64("1. f3 e5 2. g4"), timeoutMs: 5000 };
    const first = await requestJson(port, "POST", "/v1/style-lines/jobs", body);
    const firstEventsPromise = collectSse(port, first.body.jobId, ["cancelled"]);
    const second = await requestJson(port, "POST", "/v1/style-lines/jobs", body);
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(second.body.jobId).not.toBe(first.body.jobId);

    const firstEvents = await firstEventsPromise;
    expect(firstEvents.at(-1).type).toBe("cancelled");
    expect(firstEvents.at(-1).data.status).toBe("cancelled");

    const secondEvents = await collectSse(port, second.body.jobId, ["complete"]);
    expect(secondEvents.at(-1).type).toBe("complete");
    expect(secondEvents.at(-1).data.status).toBe("complete");
  } finally {
    await close(server);
  }
});

test("Style server SSE streams queued, started, progress, and complete", async () => {
  const { server, port } = await listen(createStyleLineJobServer({ token }, { chess, createProviders: () => providersFor(() => "d8h4") }));
  try {
    const created = await requestJson(port, "POST", "/v1/style-lines/jobs", { rawGameBase64: rawBase64("1. f3 e5 2. g4"), refreshMs: 250 });
    const events = await collectSse(port, created.body.jobId, ["queued", "started", "progress", "complete"]);
    expect(events.map(event => event.type)).toEqual(expect.arrayContaining(["queued", "started", "progress", "complete"]));
    expect(events.at(-1).type).toBe("complete");
    expect(events.at(-1).data.status).toBe("complete");
    expect(events.at(-1).data.lines.every(line => line.status === "Terminal")).toBe(true);
  } finally {
    await close(server);
  }
});

test("Style server maxFullMoves guard completes non-terminal lines honestly", async () => {
  const { server, port } = await listen(createStyleLineJobServer({ token }, {
    chess,
    createProviders: () => providersFor(() => "e7e5", () => "g1f3")
  }));
  try {
    const created = await requestJson(port, "POST", "/v1/style-lines/jobs", {
      rawGameBase64: rawBase64("1. e4"),
      maxFullMoves: 1,
      refreshMs: 250
    });
    const events = await collectSse(port, created.body.jobId, ["complete"]);
    const complete = events.at(-1);
    expect(complete.data.status).toBe("complete");
    expect(complete.data.lines.every(line => line.status === "Complete")).toBe(true);
  } finally {
    await close(server);
  }
});

test("Style server timeout guard emits final error and closes stream", async () => {
  const never = new Promise(() => undefined);
  const { server, port } = await listen(createStyleLineJobServer({ token }, {
    chess,
    createProviders: () => providersFor(() => never)
  }));
  try {
    const created = await requestJson(port, "POST", "/v1/style-lines/jobs", {
      rawGameBase64: rawBase64("1. e4"),
      timeoutMs: 1000,
      refreshMs: 250
    });
    const events = await collectSse(port, created.body.jobId, ["error"]);
    const error = events.at(-1);
    expect(error.type).toBe("error");
    expect(error.data.status).toBe("error");
    expect(error.data.error.code).toBe("PROVIDER_TIMEOUT");
  } finally {
    await close(server);
  }
});
