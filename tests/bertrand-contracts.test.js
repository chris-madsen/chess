import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createChessJsRulesAdapter,
  ensureDecisionIsNotPlatformCommand,
  generateHumanPath
} from "../src/wiring/index.ts";
import {
  domainError,
  isErr,
  isOk,
  makeCandidateSeed,
  makeRequestId,
  makeScenarioHorizon,
  maiaProvider,
  playerProvider,
  stockfishProvider,
  transitionScenarioLine
} from "../src/domain/index.ts";

const chess = createChessJsRulesAdapter();
const startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const provenance = (source, provider, position, requestId = "request-1") => ({
  source,
  provider,
  status: source === "PLAYER_IDEA" ? "PLAYER_ENTERED" : source === "MAIA" ? "MODELED_LOCAL" : "ENGINE_GENERATED",
  requestId: makeRequestId(requestId),
  inputPositionHash: position.hash,
  configuration: {}
});

const mustOk = result => {
  expect(result.tag).toBe("Ok");
  return result.value;
};

const providerFromMove = (source, providerIdentity, rawMove, requestId) => async request => {
  const moveResult = chess.parseLegalMove(request.position, rawMove);
  if (isErr(moveResult)) {
    return moveResult;
  }
  return {
    tag: "Ok",
    value: {
      move: moveResult.value,
      provenance: provenance(source, providerIdentity, request.position, `${requestId}-${request.ply}`)
    }
  };
};

test("BTC-01 invalid FEN rejects before providers", async () => {
  const positionResult = chess.ingestPosition("not a fen");
  expect(positionResult.tag).toBe("Err");
  expect(positionResult.error.code).toBe("INVALID_FEN");
});

test("BTC-02 illegal CandidateSeed rejects before providers", async () => {
  const position = mustOk(chess.ingestPosition(startFen));
  const legalSeedMove = mustOk(chess.parseLegalMove(position, "e2e4"));
  const seed = mustOk(makeCandidateSeed(legalSeedMove, provenance("PLAYER_IDEA", playerProvider, position)));
  const illegalSeed = { ...seed, move: { ...seed.move, uci: "e2e5" } };
  let called = 0;
  const providers = {
    maia: async () => { called += 1; return { tag: "Err", error: domainError("PROVIDER_UNAVAILABLE", "maia", "unexpected") }; },
    stockfish: async () => { called += 1; return { tag: "Err", error: domainError("PROVIDER_UNAVAILABLE", "stockfish", "unexpected") }; }
  };
  const lineResult = await generateHumanPath(chess, providers, {
    lineId: "line-illegal-seed",
    start: position,
    seed: illegalSeed,
    horizon: mustOk(makeScenarioHorizon(4))
  });
  expect(lineResult.tag).toBe("Err");
  expect(lineResult.error.code).toBe("ILLEGAL_MOVE");
  expect(called).toBe(0);
});

test("BTC-03 and BTC-04 accepted plies are legal and provenanced", async () => {
  const position = mustOk(chess.ingestPosition(startFen));
  const seedMove = mustOk(chess.parseLegalMove(position, "e2e4"));
  const seed = mustOk(makeCandidateSeed(seedMove, provenance("PLAYER_IDEA", playerProvider, position)));
  const line = mustOk(await generateHumanPath(chess, {
    maia: providerFromMove("MAIA", maiaProvider(), "e7e5", "maia"),
    stockfish: providerFromMove("STOCKFISH", stockfishProvider(), "g1f3", "stockfish")
  }, {
    lineId: "line-legal",
    start: position,
    seed,
    horizon: mustOk(makeScenarioHorizon(3))
  }));
  expect(line.status).toBe("Complete");
  expect(line.plies).toHaveLength(3);
  expect(line.plies.every(ply => ply.provenance && ply.move.tag === "LegalMove")).toBe(true);
});

test("BTC-04 CandidateSeed cannot be built without provenance", () => {
  const position = mustOk(chess.ingestPosition(startFen));
  const seedMove = mustOk(chess.parseLegalMove(position, "e2e4"));
  const seedResult = makeCandidateSeed(seedMove, undefined);
  expect(seedResult.tag).toBe("Err");
  expect(seedResult.error.code).toBe("MISSING_PROVENANCE");
});

test("BTC-05 HumanPath source order is enforced", async () => {
  const position = mustOk(chess.ingestPosition(startFen));
  const seedMove = mustOk(chess.parseLegalMove(position, "d2d4"));
  const seed = mustOk(makeCandidateSeed(seedMove, provenance("PLAYER_IDEA", playerProvider, position)));
  const line = mustOk(await generateHumanPath(chess, {
    maia: providerFromMove("STOCKFISH", stockfishProvider(), "d7d5", "wrong-source"),
    stockfish: providerFromMove("STOCKFISH", stockfishProvider(), "c2c4", "stockfish")
  }, {
    lineId: "line-source-order",
    start: position,
    seed,
    horizon: mustOk(makeScenarioHorizon(3))
  }));
  expect(line.status).toBe("Incomplete");
  expect(line.error.code).toBe("SOURCE_SEQUENCE_VIOLATION");
  expect(line.plies).toHaveLength(1);
});

test("BTC-06 external bot seed does not label continuation as bot line", async () => {
  const position = mustOk(chess.ingestPosition(startFen));
  const seedMove = mustOk(chess.parseLegalMove(position, "g1f3"));
  const seed = mustOk(makeCandidateSeed(seedMove, {
    source: "LEELA_ALIEN_PROBE",
    provider: { name: "leela-alien", displayName: "LeelaAlien" },
    status: "OBSERVED_EXTERNAL",
    requestId: makeRequestId("alien-seed"),
    inputPositionHash: position.hash,
    configuration: { probe: "bounded" }
  }));
  const line = mustOk(await generateHumanPath(chess, {
    maia: providerFromMove("MAIA", maiaProvider(), "g8f6", "maia"),
    stockfish: providerFromMove("STOCKFISH", stockfishProvider(), "d2d4", "stockfish")
  }, {
    lineId: "line-alien-seed",
    start: position,
    seed,
    horizon: mustOk(makeScenarioHorizon(3))
  }));
  expect(line.label).toBe("HumanPath ScenarioLine");
  expect(line.label).not.toContain("LeelaAlien PV");
  expect(line.plies.map(ply => ply.provenance.source)).toEqual(["LEELA_ALIEN_PROBE", "MAIA", "STOCKFISH"]);
});

test("BTC-07 provider timeout creates incomplete line without invented plies", async () => {
  const position = mustOk(chess.ingestPosition(startFen));
  const seedMove = mustOk(chess.parseLegalMove(position, "e2e4"));
  const seed = mustOk(makeCandidateSeed(seedMove, provenance("PLAYER_IDEA", playerProvider, position)));
  const line = mustOk(await generateHumanPath(chess, {
    maia: async () => ({ tag: "Err", error: domainError("PROVIDER_TIMEOUT", "maia", "timeout") }),
    stockfish: providerFromMove("STOCKFISH", stockfishProvider(), "g1f3", "stockfish")
  }, {
    lineId: "line-timeout",
    start: position,
    seed,
    horizon: mustOk(makeScenarioHorizon(4))
  }));
  expect(line.status).toBe("Incomplete");
  expect(line.error.code).toBe("PROVIDER_TIMEOUT");
  expect(line.plies).toHaveLength(1);
});

test("BTC-07 provider illegal move creates incomplete line without appending it", async () => {
  const position = mustOk(chess.ingestPosition(startFen));
  const seedMove = mustOk(chess.parseLegalMove(position, "e2e4"));
  const seed = mustOk(makeCandidateSeed(seedMove, provenance("PLAYER_IDEA", playerProvider, position)));
  const illegalMoveFromStartPosition = mustOk(chess.parseLegalMove(position, "g1f3"));
  const line = mustOk(await generateHumanPath(chess, {
    maia: async request => ({
      tag: "Ok",
      value: {
        move: illegalMoveFromStartPosition,
        provenance: provenance("MAIA", maiaProvider(), request.position, "maia-illegal")
      }
    }),
    stockfish: providerFromMove("STOCKFISH", stockfishProvider(), "g1f3", "stockfish")
  }, {
    lineId: "line-illegal-provider",
    start: position,
    seed,
    horizon: mustOk(makeScenarioHorizon(4))
  }));
  expect(line.status).toBe("Incomplete");
  expect(line.error.code).toBe("PROVIDER_ILLEGAL_MOVE");
  expect(line.plies).toHaveLength(1);
});

test("BTC-08 Decision cannot become PlatformCommand", () => {
  expect(isOk(ensureDecisionIsNotPlatformCommand("Decision"))).toBe(true);
  const result = ensureDecisionIsNotPlatformCommand("PlatformCommand");
  expect(result.tag).toBe("Err");
  expect(result.error.code).toBe("EXTERNAL_WRITE_FORBIDDEN");
});

test("BTC-09 invalid FSM transition fails closed", () => {
  const result = transitionScenarioLine({ tag: "SeedPending" }, "AcceptStockfish");
  expect(result.tag).toBe("Err");
  expect(result.error.code).toBe("INVALID_STATE_TRANSITION");
});

test("BTC-10 domain imports no adapters or external process/platform modules", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const domainDir = path.join(root, "src", "domain");
  const files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      if (entry.isFile() && entry.name.endsWith(".ts")) files.push(full);
    }
  };
  walk(domainDir);
  const forbidden = ["adapters/", "chess.js", "node:fs", "node:child_process", "lichess", "openai"];
  const offenders = files.flatMap(file => {
    const text = fs.readFileSync(file, "utf8");
    return forbidden.filter(pattern => text.includes(pattern)).map(pattern => `${path.relative(root, file)} -> ${pattern}`);
  });
  expect(offenders).toEqual([]);
});
