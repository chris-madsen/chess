import { jest } from "@jest/globals";
import {
  DEPTH_STABLE_MS,
  HORIZON_STABLE_MS,
  INITIAL_ANALYSIS_SETTINGS,
  WATCH_CLEAR_TO_END,
  analyzeStylePathsOnce,
  nextAdaptiveAnalysisState,
  parseCliOptions,
  renderStyleApiJobSnapshot,
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
  const options = mustOk(parseCliOptions(["--fen", startFen]));
  const seenRequests = [];
  const ports = testPorts(() => "", fullGameStyleMoves, fullGameMaiaMoves, seenRequests);
  const result = await analyzeStylePathsOnce(options, ports);
  const text = mustOk(result);
  expect(text).toContain("## Patricia StylePath depth 13 horizon 8");
  expect(text.indexOf("## Patricia StylePath")).toBeLessThan(text.indexOf("StylePath analysis @"));
  expect(text).toContain("Player side inferred from turn: white");
  expect(text).toContain("Adaptive settings: style depth 13, horizon 8 full moves");
  expect(text).toContain("1. e4 e5 2. Nf3 Nc6");
  expect(text).not.toContain("(e2e4)");
  expect(text).not.toContain("LOCAL_STYLE_ENGINE");
  expect(seenRequests.filter(request => request.ply % 2 === 1).every(request => request.searchLimit?.tag === "Depth" && request.searchLimit.depth === 13)).toBe(true);
});

test("CLI rejects removed user --horizon flag", () => {
  const result = parseCliOptions(["--fen", startFen, "--horizon", "6"]);
  expect(result.tag).toBe("Err");
  expect(result.error.code).toBe("INVALID_HORIZON");
});

test("CLI parses cstal-windows suite and renders CSTal lines", async () => {
  const options = mustOk(parseCliOptions(["--fen", startFen, "--engine-suite", "cstal-windows"]));
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
  const ports = testPorts(() => "", fullGameStyleMoves, fullGameMaiaMoves, seenRequests, styleEngines);
  const result = await analyzeStylePathsOnce(options, ports);
  const text = mustOk(result);

  expect(options.engineSuite).toBe("cstal-windows");
  expect(text).toContain("## CSTal ABSURD StylePath depth 13 horizon 8");
  expect(text).toContain("## CSTal EXTREME StylePath depth 13 horizon 8");
  expect(text).toContain("1. e4 e5 2. Nf3 Nc6");
});

test("CLI parses CSTal opponent selection", () => {
  const options = mustOk(parseCliOptions(["--fen", startFen, "--engine-suite", "cstal-windows", "--cstal-opponent", "maia1900", "--maia3-elo", "1800"]));
  expect(options.engineSuite).toBe("cstal-windows");
  expect(options.cstalOpponent).toBe("maia1900");
  expect(options.maia3Elo).toBe(1800);

  const invalid = parseCliOptions(["--fen", startFen, "--engine-suite", "cstal-windows", "--cstal-opponent", "both"]);
  expect(invalid.tag).toBe("Err");
  expect(invalid.error.path).toBe("cli.cstalOpponent");

  const invalidElo = parseCliOptions(["--fen", startFen, "--engine-suite", "cstal-windows", "--maia3-elo", "wat"]);
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
  const ports = testPorts(() => "", fullGameStyleMoves, fullGameMaiaMoves, [], [slowStyle]);
  const promise = runCli(["--fen", startFen], ports);
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(ports.write).toHaveBeenCalled();
  expect(ports.write.mock.calls[0][0]).toContain("## Slow CSTal StylePath depth 14 horizon 8");
  expect(ports.write.mock.calls[0][0]).toContain("status: Analyzing");

  await expect(promise).resolves.toBe(0);
});

test("CLI one-shot RAW file appends continuation to original movetext", async () => {
  const options = mustOk(parseCliOptions(["--raw-file", "game.txt"]));
  const ports = testPorts(path => {
    expect(path).toBe("game.txt");
    return "1. e4 c5";
  }, sicilianStyleMoves, sicilianMaiaMoves);
  const result = await analyzeStylePathsOnce(options, ports);
  const text = mustOk(result);
  expect(text).toContain("Player side inferred from turn: white");
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
  const promise = runCli(["--fen", startFen, "--watch", "--refresh-ms", "250"], ports);
  await new Promise(resolve => setTimeout(resolve, 750));
  expect(ports.write.mock.calls.length).toBeGreaterThanOrEqual(1);
  expect(ports.write.mock.calls.length).toBeLessThanOrEqual(3);
  const writes = ports.write.mock.calls.map(call => call[0]);
  expect(writes[0].startsWith("\x1b")).toBe(false);
  for (const text of writes) {
    expect(text).not.toContain("\x1b[H");
    expect(text).not.toContain("\x1b[2J");
    expect(text).not.toContain("\x1b[3J");
    expect((text.match(/## Patricia StylePath/g) ?? []).length).toBe(1);
    expect(text).toContain("StylePath analysis @");
  }
  if (writes.length > 1) {
    expect(writes.slice(1).some(text => text.includes(WATCH_CLEAR_TO_END))).toBe(true);
  }
  process.emit("SIGINT");
  await expect(promise).resolves.toBe(0);
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
  expect((rendered.match(/## CSTal ABSURD/g) ?? []).length).toBe(1);
  expect((rendered.match(/## CSTal EXTREME/g) ?? []).length).toBe(1);
  expect(rendered).toContain("StylePath API job job-1");
  expect(styleApiSnapshotSignature(snapshot)).toBe(styleApiSnapshotSignature({
    ...snapshot,
    createdAt: "2026-09-17T18:00:02.000Z"
  }));
});
