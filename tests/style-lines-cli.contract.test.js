import { jest } from "@jest/globals";
import {
  DEPTH_STABLE_MS,
  HORIZON_STABLE_MS,
  INITIAL_ANALYSIS_SETTINGS,
  WATCH_CLEAR_TO_END,
  analyzeStylePathsOnce,
  defaultStyleApiBaseUrlForPlatform,
  ingestInput,
  nextAdaptiveAnalysisState,
  parseCliOptions,
  renderStyleApiJobSnapshot,
  styleJobRequestBody,
  styleApiSnapshotSignature,
  runCli
} from "../src/cli/style-lines.ts";
import { createChessJsRulesAdapter } from "../src/wiring/index.ts";
import {
  makeRequestId,
  maiaProvider,
  localStyleEngineProvider
} from "../src/domain/index.ts";

const chess = createChessJsRulesAdapter();
const startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

test("Style API defaults to the local Windows server and the public endpoint elsewhere", () => {
  expect(defaultStyleApiBaseUrlForPlatform("win32", {})).toBe("http://127.0.0.1:8787");
  expect(defaultStyleApiBaseUrlForPlatform("linux", {})).toBe("https://chess.network-communications.net");
  expect(defaultStyleApiBaseUrlForPlatform("win32", {
    STYLE_SERVER_HOST: "10.0.0.5",
    STYLE_SERVER_PORT: "9000"
  })).toBe("http://10.0.0.5:9000");
  expect(defaultStyleApiBaseUrlForPlatform("win32", {
    CHESS_STYLE_API_BASE_URL: "https://example.test/"
  })).toBe("https://example.test");
});

const fullGameStyleMoves = {
  1: "e2e4",
  3: "g1f3",
  5: "f1b5",
  7: "b5a4",
  9: "e1g1",
  11: "f1e1",
  13: "a4b3",
  15: "c2c3"
};

const fullGameMaiaMoves = {
  2: "e7e5",
  4: "b8c6",
  6: "a7a6",
  8: "g8f6",
  10: "f8e7",
  12: "b7b5",
  14: "d7d6",
  16: "e8g8"
};

const sicilianStyleMoves = {
  1: "g1f3",
  3: "d2d4",
  5: "f3d4",
  7: "b1c3",
  9: "c1e3",
  11: "f2f3",
  13: "d1d2",
  15: "e1c1"
};

const sicilianMaiaMoves = {
  2: "d7d6",
  4: "c5d4",
  6: "g8f6",
  8: "g7g6",
  10: "f8g7",
  12: "e8g8",
  14: "b8c6",
  16: "c8d7"
};

const mustOk = result => {
  expect(result.tag).toBe("Ok");
  return result.value;
};

const scriptedProvider = (source, provider, movesByPly, seenRequests = []) => async request => {
  seenRequests.push(request);
  const move = movesByPly[request.ply];
  if (move === undefined) {
    return { tag: "Err", error: { code: "PROVIDER_MALFORMED_OUTPUT", path: provider.name, message: "missing scripted move" } };
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

const testPorts = (
  readTextFile,
  styleMoves = fullGameStyleMoves,
  maiaMoves = fullGameMaiaMoves,
  seenRequests = [],
  styleEngines = [{
    key: "patricia",
    source: "LOCAL_STYLE_ENGINE",
    identity: localStyleEngineProvider("patricia", "Patricia", "test"),
    configuration: {},
    provideMove: scriptedProvider("LOCAL_STYLE_ENGINE", localStyleEngineProvider("patricia", "Patricia", "test"), styleMoves, seenRequests)
  }]
) => ({
  chess,
  providers: {
    maia: scriptedProvider("MAIA", maiaProvider(), maiaMoves, seenRequests),
    styleEngines
  },
  readTextFile,
  write: jest.fn(),
  writeError: jest.fn()
});

test("CLI one-shot FEN renders SAN StylePath output with adaptive defaults", async () => {
  const options = mustOk(parseCliOptions(["--file-fen", "game-fen.txt"]));
  const seenRequests = [];
  const ports = testPorts(() => startFen, fullGameStyleMoves, fullGameMaiaMoves, seenRequests);
  const result = await analyzeStylePathsOnce(options, ports);
  const text = mustOk(result);
  expect(text).toContain('[Variant "From Position"]');
  expect(text).toContain(`[FEN "${startFen}"]`);
  expect(text).toContain('[Engine "Patricia StylePath"]');
  expect(text.indexOf('[Engine "Patricia StylePath"]')).toBeLessThan(text.indexOf("1. e4 e5"));
  expect(text).toContain("1. e4 e5 2. Nf3 Nc6");
  expect(text).not.toContain("(e2e4)");
  expect(text).not.toContain("LOCAL_STYLE_ENGINE");
  expect(seenRequests.filter(request => request.ply % 2 === 1).every(request => request.searchLimit?.tag === "Depth" && request.searchLimit.depth === 13)).toBe(true);
});

test("CLI requires exactly one new file input and rejects legacy flags", () => {
  expect(parseCliOptions([]).tag).toBe("Err");
  expect(parseCliOptions(["--file-pgn", "game.txt", "--file-fen", "game-fen.txt"]).tag).toBe("Err");
  expect(parseCliOptions(["--raw-file", "game.txt"]).error.message).toContain("--file-pgn or --file-fen");
  expect(parseCliOptions(["--fen", startFen]).error.message).toContain("--file-pgn or --file-fen");
});

test("FEN file ingestion trims file framing and preserves black fullmove numbering", () => {
  const options = mustOk(parseCliOptions(["--file-fen", "game-fen.txt"]));
  const ingested = mustOk(ingestInput(options, {
    chess,
    readTextFile: path => {
      expect(path).toBe("game-fen.txt");
      return "  4k3/8/8/8/8/8/8/4K3 b - - 0 17\n";
    }
  }));
  expect(ingested.baseSanMoves).toEqual([]);
  expect(ingested.lineStartSide).toBe("black");
  expect(ingested.lineStartFullmove).toBe(17);
  expect(String(ingested.position.fen)).toContain(" b ");
});

test("empty and invalid FEN files fail before providers are called", () => {
  const options = mustOk(parseCliOptions(["--file-fen", "game-fen.txt"]));
  const empty = ingestInput(options, { chess, readTextFile: () => " \n" });
  expect(empty.tag).toBe("Err");
  expect(empty.error.code).toBe("INVALID_FEN");
  const invalid = ingestInput(options, { chess, readTextFile: () => "not a fen" });
  expect(invalid.tag).toBe("Err");
  expect(invalid.error.code).toBe("INVALID_FEN");
});

test("CLI rejects removed user --horizon flag", () => {
  const result = parseCliOptions(["--file-fen", "game-fen.txt", "--horizon", "6"]);
  expect(result.tag).toBe("Err");
  expect(result.error.code).toBe("INVALID_HORIZON");
});

test("CLI parses cstal-windows suite and renders CSTal lines", async () => {
  const options = mustOk(parseCliOptions(["--file-fen", "game-fen.txt", "--engine-suite", "cstal-windows"]));
  const seenRequests = [];
  const styleEngines = [
    {
      key: "cstal-absurd",
      source: "LOCAL_STYLE_ENGINE",
      identity: localStyleEngineProvider("cstal-absurd", "CSTal ABSURD", "test"),
      configuration: { styleDepth: 13 },
      provideMove: scriptedProvider("LOCAL_STYLE_ENGINE", localStyleEngineProvider("cstal-absurd", "CSTal ABSURD", "test"), fullGameStyleMoves, seenRequests)
    },
    {
      key: "cstal-extreme",
      source: "LOCAL_STYLE_ENGINE",
      identity: localStyleEngineProvider("cstal-extreme", "CSTal EXTREME", "test"),
      configuration: { styleDepth: 13 },
      provideMove: scriptedProvider("LOCAL_STYLE_ENGINE", localStyleEngineProvider("cstal-extreme", "CSTal EXTREME", "test"), fullGameStyleMoves, seenRequests)
    }
  ];
  const ports = testPorts(() => startFen, fullGameStyleMoves, fullGameMaiaMoves, seenRequests, styleEngines);
  const result = await analyzeStylePathsOnce(options, ports);
  const text = mustOk(result);

  expect(options.engineSuite).toBe("cstal-windows");
  expect(text).toContain("[Engine \"CSTal ABSURD StylePath\"]");
  expect(text).toContain("[Engine \"CSTal EXTREME StylePath\"]");
  expect(text).toContain("1. e4 e5 2. Nf3 Nc6");
});

test("CLI parses CSTal opponent selection", () => {
  const options = mustOk(parseCliOptions(["--file-fen", "game-fen.txt", "--engine-suite", "cstal-windows", "--cstal-opponent", "maia1900", "--maia3-elo", "1800"]));
  expect(options.engineSuite).toBe("cstal-windows");
  expect(options.cstalOpponent).toBe("maia1900");
  expect(options.maia3Elo).toBe(1800);

  const invalid = parseCliOptions(["--file-fen", "game-fen.txt", "--engine-suite", "cstal-windows", "--cstal-opponent", "both"]);
  expect(invalid.tag).toBe("Err");
  expect(invalid.error.path).toBe("cli.cstalOpponent");

  const invalidElo = parseCliOptions(["--file-fen", "game-fen.txt", "--engine-suite", "cstal-windows", "--maia3-elo", "wat"]);
  expect(invalidElo.tag).toBe("Err");
  expect(invalidElo.error.path).toBe("cli.maia3Elo");
});

test("CLI one-shot writes an analyzing frame before slow providers finish", async () => {
  const slowStyle = {
    key: "slow-cstal",
    source: "LOCAL_STYLE_ENGINE",
    identity: localStyleEngineProvider("slow-cstal", "Slow CSTal", "test"),
    configuration: { styleDepth: 14 },
    provideMove: async request => {
      await new Promise(resolve => setTimeout(resolve, 50));
      const parsed = chess.parseLegalMove(request.position, "e2e4");
      if (parsed.tag === "Err") return parsed;
      return {
        tag: "Ok",
        value: {
          move: parsed.value,
          provenance: {
            source: "LOCAL_STYLE_ENGINE",
            provider: localStyleEngineProvider("slow-cstal", "Slow CSTal", "test"),
            status: "ENGINE_GENERATED",
            requestId: makeRequestId("slow-cstal-1"),
            inputPositionHash: request.position.hash,
            configuration: {}
          }
        }
      };
    }
  };
  const ports = testPorts(() => startFen, fullGameStyleMoves, fullGameMaiaMoves, [], [slowStyle]);
  const promise = runCli(["--file-fen", "game-fen.txt"], ports);
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(ports.write).toHaveBeenCalled();
  expect(ports.write.mock.calls[0][0]).toContain("[Engine \"Slow CSTal StylePath\"]");
  expect(ports.write.mock.calls[0][0]).toContain("{Status: Analyzing}");

  await expect(promise).resolves.toBe(0);
});

test("CLI one-shot RAW file appends continuation to original movetext", async () => {
  const options = mustOk(parseCliOptions(["--file-pgn", "game.txt"]));
  const ports = testPorts(path => {
    expect(path).toBe("game.txt");
    return "1. e4 c5";
  }, sicilianStyleMoves, sicilianMaiaMoves);
  const result = await analyzeStylePathsOnce(options, ports);
  const text = mustOk(result);
  expect(text).toContain("[Event \"StylePath\"]");
  expect(text).not.toContain("[Variant \"From Position\"]");
  expect(text).toContain("1. e4 c5 2. Nf3 d6 3. d4 cxd4");
});

test("adaptive analysis increases depth after 5 stable seconds and horizon after 10 stable seconds", () => {
  const base = {
    settings: INITIAL_ANALYSIS_SETTINGS,
    stableSinceMs: 0,
    depthLastIncreasedAtMs: 0,
    horizonLastIncreasedAtMs: 0
  };
  const first = nextAdaptiveAnalysisState(base, "same-line", 1000);
  expect(first.settings).toEqual(INITIAL_ANALYSIS_SETTINGS);

  const depthRaised = nextAdaptiveAnalysisState(first, "same-line", 1000 + DEPTH_STABLE_MS);
  expect(depthRaised.settings).toEqual({ horizonMoves: 8, styleDepth: 15 });

  const horizonRaised = nextAdaptiveAnalysisState(depthRaised, "same-line", 1000 + HORIZON_STABLE_MS);
  expect(horizonRaised.settings).toEqual({ horizonMoves: 10, styleDepth: 17 });
});

test("CLI watch mode refreshes continuously with local block redraw", async () => {
  const ports = testPorts(() => startFen);
  const promise = runCli(["--file-fen", "game-fen.txt", "--watch", "--refresh-ms", "250", "--bot-engine", "local"], ports);
  await new Promise(resolve => setTimeout(resolve, 750));
  expect(ports.write.mock.calls.length).toBeGreaterThanOrEqual(1);
  expect(ports.write.mock.calls.length).toBeLessThanOrEqual(4);
  const writes = ports.write.mock.calls.map(call => call[0]);
  expect(writes[0].startsWith("\x1b")).toBe(false);
  const renderedWrites = writes.filter(text => text.includes("[Event \"StylePath\"]"));
  expect(renderedWrites.length).toBeGreaterThanOrEqual(1);
  for (const text of renderedWrites) {
    expect(text).not.toContain("\x1b[H");
    expect(text).not.toContain("\x1b[2J");
    expect(text).not.toContain("\x1b[3J");
    expect((text.match(/\[Engine "Patricia StylePath"\]/g) ?? []).length).toBe(1);
    expect(text).toContain('[Event "StylePath"]');
  }
  if (writes.length > 1) {
    expect(writes.slice(1).some(text => text.includes(WATCH_CLEAR_TO_END))).toBe(true);
  }
  process.emit("SIGINT");
  await expect(promise).resolves.toBe(0);
});

test("CLI bot engine defaults to Tal and validates selection", () => {
  const options = mustOk(parseCliOptions(["--file-pgn", "game.txt", "--watch"]));
  expect(options.botEngine).toBe("tal");

  const local = mustOk(parseCliOptions(["--file-pgn", "game.txt", "--watch", "--bot-engine", "local"]));
  expect(local.botEngine).toBe("local");

  const invalid = parseCliOptions(["--file-pgn", "game.txt", "--watch", "--bot-engine", "unknown"]);
  expect(invalid.tag).toBe("Err");
  expect(invalid.error.path).toBe("cli.botEngine");
});

test("CLI RAW watch with default Tal reads local file and renders API job events", async () => {
  const createdRequests = [];
  const api = {
    createJob: async request => {
      createdRequests.push(request);
      return { tag: "Ok", value: "job-1" };
    },
    streamEvents: async (jobId, onSnapshot, signal) => {
      expect(jobId).toBe("job-1");
      onSnapshot({
        jobId,
        status: "running",
        settings: { horizonMoves: 8, styleDepth: 13, maxFullMoves: 80, refreshMs: 2000, timeoutMs: 300000, cstalOpponent: "maia3", maia3Elo: 1900 },
        input: { fen: startFen, sideToMove: "white" },
        lines: [{
          engineKey: "cstal-absurd-maia3",
          label: "CSTal ABSURD vs Maia3 79M StylePath",
          status: "Terminal",
          styleDepth: 14,
          sanMovetext: "1. e4 e5 2. Nf3#",
          plies: [{ index: 1, san: "e4", uci: "e2e4", source: "LOCAL_STYLE_ENGINE", provider: "CSTal ABSURD" }]
        }]
      }, "progress");
      await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }));
      return { tag: "Ok", value: undefined };
    }
  };
  const ports = {
    readTextFile: path => {
      expect(path).toBe("game.txt");
      return "1. e4 c5";
    },
    write: jest.fn(),
    writeError: jest.fn(),
    styleJobApi: api
  };

  const promise = runCli(["--file-pgn", "game.txt", "--watch", "--refresh-ms", "2000"], ports);
  await new Promise(resolve => setTimeout(resolve, 20));
  process.emit("SIGINT");
  await expect(promise).resolves.toBe(0);

  expect(createdRequests).toEqual([expect.objectContaining({
    input: { tag: "Pgn", rawGame: "1. e4 c5" },
    botEngine: "tal",
    cstalOpponent: "maia3",
    maia3Elo: 1900,
    refreshMs: 2000,
    maxFullMoves: 80,
    timeoutMs: 300000
  })]);
  const output = ports.write.mock.calls.map(call => call[0]).join("\n");
  expect(output).toContain("CSTal ABSURD vs Maia3 79M StylePath");
  expect(output).toContain("1. e4 e5 2. Nf3#");
  expect(output).toContain("[Event \"StylePath\"]");
  expect(output).not.toContain("Patricia StylePath");
});

test("CLI FEN watch sends only fen to the StylePath API", async () => {
  const createdRequests = [];
  const api = {
    createJob: async request => {
      createdRequests.push(request);
      return { tag: "Ok", value: "fen-job-1" };
    },
    streamEvents: async (jobId, onSnapshot, signal) => {
      expect(jobId).toBe("fen-job-1");
      await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }));
      return { tag: "Ok", value: undefined };
    }
  };
  const ports = {
    readTextFile: path => {
      expect(path).toBe("game-fen.txt");
      return `  ${startFen}\n`;
    },
    write: jest.fn(),
    writeError: jest.fn(),
    styleJobApi: api
  };

  const promise = runCli(["--file-fen", "game-fen.txt", "--watch", "--refresh-ms", "2000"], ports);
  await new Promise(resolve => setTimeout(resolve, 20));
  process.emit("SIGINT");
  await expect(promise).resolves.toBe(0);

  expect(createdRequests).toEqual([expect.objectContaining({
    input: { tag: "Fen", fen: startFen },
    botEngine: "tal"
  })]);
});

test("API request body never mixes PGN and FEN fields", () => {
  const common = {
    botEngine: "tal",
    cstalOpponent: "maia3",
    maia3Elo: 1900,
    refreshMs: 2000,
    maxFullMoves: 80,
    timeoutMs: 300000
  };
  const pgnBody = styleJobRequestBody({ ...common, input: { tag: "Pgn", rawGame: "1. e4" } });
  const fenBody = styleJobRequestBody({ ...common, input: { tag: "Fen", fen: startFen } });
  expect(pgnBody).toHaveProperty("rawGameBase64");
  expect(pgnBody).not.toHaveProperty("fen");
  expect(fenBody).toHaveProperty("fen", startFen);
  expect(fenBody).not.toHaveProperty("rawGameBase64");
});

test("CLI API snapshot renderer is stable for duplicate progress events", () => {
  const snapshot = {
    jobId: "job-1",
    status: "running",
    createdAt: "2026-09-17T18:00:00.000Z",
    settings: {
      horizonMoves: 8,
      styleDepth: 14,
      maxFullMoves: 80,
      refreshMs: 2000,
      timeoutMs: 300000,
      cstalOpponent: "maia3",
      maia3Elo: 2100
    },
    input: {
      fen: startFen,
      sideToMove: "white"
    },
    lines: [
      {
        engineKey: "cstal-absurd-maia3",
        label: "CSTal ABSURD vs Maia3 79M StylePath",
        status: "Incomplete",
        styleDepth: 14,
        sanMovetext: "1. e4 e6",
        plies: [{ san: "e4", uci: "e2e4" }, { san: "e6", uci: "e7e6" }]
      },
      {
        engineKey: "cstal-extreme-maia3",
        label: "CSTal EXTREME vs Maia3 79M StylePath",
        status: "Incomplete",
        styleDepth: 14,
        sanMovetext: "1. e4 e6",
        plies: [{ san: "e4", uci: "e2e4" }, { san: "e6", uci: "e7e6" }]
      }
    ]
  };
  const rendered = renderStyleApiJobSnapshot(snapshot, "2026-09-17T18:00:01.000Z");
  expect((rendered.match(/\[Engine "CSTal ABSURD vs Maia3 79M StylePath"\]/g) ?? []).length).toBe(1);
  expect((rendered.match(/\[Engine "CSTal EXTREME vs Maia3 79M StylePath"\]/g) ?? []).length).toBe(1);
  expect(rendered).toContain(`[FEN "${startFen}"]`);
  expect(styleApiSnapshotSignature(snapshot)).toBe(styleApiSnapshotSignature({
    ...snapshot,
    createdAt: "2026-09-17T18:00:02.000Z"
  }));
});
