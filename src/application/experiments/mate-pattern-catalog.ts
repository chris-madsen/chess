import { Chess } from "chess.js";
import { PATTERN_FAMILY_CATALOG, type PatternFamilyId } from "../../domain/patterns/pattern";
import { TACTICAL_MOTIF_CATALOG, type TacticalMotifId } from "../../domain/patterns/motifs";

export type MatePatternReference = Readonly<{
  caseId: string;
  fen: string;
  solutionMoves: readonly string[];
  pgn: string;
  rating: number;
  gameUrl?: string;
  sourceReference?: string;
}>;

export type MatePatternSourceMetadata = Readonly<{
  family: PatternFamilyId;
  source: "LICHESS_MATE_THEME" | "EXTENDED_REFERENCE";
  sourceKey: string;
  trainingUrl?: string;
  reference?: MatePatternReference;
}>;

type ReferenceSeed = Readonly<Omit<MatePatternReference, "pgn"> & { family: PatternFamilyId }>;

const referenceSeeds: readonly ReferenceSeed[] = [
  { family: "ANASTASIA", caseId: "anastasia-01J5O", fen: "r4r1k/1pp1NppR/3p4/p3n3/4P3/1PPP2P1/1P1K2P1/3R4 b - - 0 22", solutionMoves: ["h8h7", "d1h1"], rating: 610, gameUrl: "https://lichess.org/2DUSUcNf/black#44", sourceReference: "https://database.lichess.org/#puzzles#01J5O" },
  { family: "ARABIAN", caseId: "arabian-01rWZ", fen: "r6k/ppp2B2/3p1b1p/4p2r/2P1Pp2/P2P1n2/1P3PRq/R4Q1K w - - 0 27", solutionMoves: ["g2h2", "h5h2"], rating: 906, gameUrl: "https://lichess.org/WFz9uXcF#53", sourceReference: "https://database.lichess.org/#puzzles#01rWZ" },
  { family: "BACK_RANK", caseId: "back_rank-00465", fen: "3r1Q1k/pp4pp/2p5/6q1/5R2/2P5/P1P2PPP/3rR1K1 b - - 8 27", solutionMoves: ["d8f8", "f4f8"], rating: 571, gameUrl: "https://lichess.org/h21VtqGG/black#54", sourceReference: "https://database.lichess.org/#puzzles#00465" },
  { family: "BALESTRA", caseId: "balestra-03YMa", fen: "r1b1k2r/pp5p/2nQ2p1/q4pN1/4p3/1B2P3/Pb1P1PPP/RN2K2R b KQkq - 1 17", solutionMoves: ["b2a1", "b3f7"], rating: 1131, gameUrl: "https://lichess.org/aCnlJCBQ/black#34", sourceReference: "https://database.lichess.org/#puzzles#03YMa" },
  { family: "BLIND_SWINE", caseId: "blind_swine-02QA4", fen: "2r1k3/pR2R3/6pp/1p4r1/1Pp1P3/5P2/P4K2/2q5 b - - 5 42", solutionMoves: ["e8d8", "b7d7"], rating: 1183, gameUrl: "https://lichess.org/0BCLJYQg/black#84", sourceReference: "https://database.lichess.org/#puzzles#02QA4" },
  { family: "BODEN", caseId: "boden-001gi", fen: "r6r/1pNk1ppp/2np4/b3p3/4P1b1/N1Q5/P4PPP/R3KB1R w KQ - 3 18", solutionMoves: ["c7a8", "a5c3"], rating: 817, gameUrl: "https://lichess.org/1sV2Hr22#35", sourceReference: "https://database.lichess.org/#puzzles#001gi" },
  { family: "CORNER", caseId: "corner-002Q2", fen: "7k/p4R1p/3p3r/2pN1n2/2PbBBb1/3P2P1/P3r3/5R1K w - - 1 28", solutionMoves: ["f4h6", "f5g3"], rating: 944, gameUrl: "https://lichess.org/yqAJ1jMv#55", sourceReference: "https://database.lichess.org/#puzzles#002Q2" },
  { family: "DOUBLE_BISHOP", caseId: "double_bishop-00FjB", fen: "rnbk3r/pppp1Bpp/8/5p2/4p3/2PP4/P1P2PPP/R1B1K2R b KQ - 0 13", solutionMoves: ["h8f8", "c1g5"], rating: 878, gameUrl: "https://lichess.org/r1BPO2dx/black#26", sourceReference: "https://database.lichess.org/#puzzles#00FjB" },
  { family: "DOVETAIL", caseId: "dovetail-00j1r", fen: "8/2rkb3/1p6/6P1/5q2/3R4/Q1P1K3/8 b - - 4 37", solutionMoves: ["d7c6", "a2d5"], rating: 1583, gameUrl: "https://lichess.org/2Nj3D5mV/black#74", sourceReference: "https://database.lichess.org/#puzzles#00j1r" },
  { family: "EPAULETTE", caseId: "epaulette-00LWX", fen: "2r4k/5p2/4pNp1/6Pp/q6P/7r/2PQ4/1RKN4 w - - 2 37", solutionMoves: ["d2b4", "c8c2"], rating: 797, gameUrl: "https://lichess.org/xNp6E0CA#73", sourceReference: "https://database.lichess.org/#puzzles#00LWX" },
  { family: "HOOK", caseId: "hook-00bJi", fen: "7k/1p2R3/p3N3/3p4/2n5/2P5/PPK4r/8 w - - 3 36", solutionMoves: ["c2d3", "h2d2"], rating: 1471, gameUrl: "https://lichess.org/7QIgY2UO#71", sourceReference: "https://database.lichess.org/#puzzles#00bJi" },
  { family: "KILL_BOX", caseId: "kill_box-02vo8", fen: "2R2bk1/5p1p/3p1p1Q/3P4/7P/q5P1/4R1K1/2n5 b - - 0 43", solutionMoves: ["c1e2", "c8f8"], rating: 581, gameUrl: "https://lichess.org/u4Mt9d1Q/black#86", sourceReference: "https://database.lichess.org/#puzzles#02vo8" },
  { family: "MORPHYS", caseId: "morphys-00y2j", fen: "3r4/1pB3kp/2b1Pp2/1pN2RpK/1P6/7P/6r1/8 w - - 0 34", solutionMoves: ["c7d8", "c6e8"], rating: 1572, gameUrl: "https://lichess.org/5qeC9Wl2#67", sourceReference: "https://database.lichess.org/#puzzles#00y2j" },
  { family: "OPERA", caseId: "opera-008LD", fen: "8/6pp/4N1k1/5p2/5P2/5rPb/4R2P/6K1 w - - 0 35", solutionMoves: ["e6g5", "f3f1"], rating: 403, gameUrl: "https://lichess.org/jzHHsjDp#69", sourceReference: "https://database.lichess.org/#puzzles#008LD" },
  { family: "PILLSBURY", caseId: "pillsbury-00bSy", fen: "1kr1r3/1pp4p/p2b2p1/3N1p2/P7/3P1Q1P/2R2PP1/2R1q1K1 w - - 7 27", solutionMoves: ["c1e1", "e8e1"], rating: 544, gameUrl: "https://lichess.org/s7Pa0Pux#53", sourceReference: "https://database.lichess.org/#puzzles#00bSy" },
  { family: "SMOTHERED", caseId: "smothered-001pC", fen: "r4rk1/pp3ppp/3b4/2p1pPB1/7N/2PP3n/PP4PP/R2Q1RqK w - - 5 18", solutionMoves: ["f1g1", "h3f2"], rating: 848, gameUrl: "https://lichess.org/d04UP3XD#35", sourceReference: "https://database.lichess.org/#puzzles#001pC" },
  { family: "SWALLOWTAIL", caseId: "swallowtail-00H1C", fen: "r3r3/1kpRnqpp/p4p2/Qp2P2P/1N6/4Pb2/PPP3P1/2K2R2 b - - 0 22", solutionMoves: ["e7c6", "a5c7"], rating: 1311, gameUrl: "https://lichess.org/GzcjOw0p/black#44", sourceReference: "https://database.lichess.org/#puzzles#00H1C" },
  { family: "TRIANGLE", caseId: "triangle-012uA", fen: "r4r2/p1p2k1R/6R1/3n1pB1/1q1Pb3/8/1P2Q1PP/6K1 b - - 2 35", solutionMoves: ["f7g6", "e2h5"], rating: 1139, gameUrl: "https://lichess.org/giEyOLMZ/black#70", sourceReference: "https://database.lichess.org/#puzzles#012uA" },
  { family: "VUKOVIC", caseId: "vukovic-00VIe", fen: "8/8/8/P6p/8/2RnkN2/r7/3K4 w - - 1 60", solutionMoves: ["f3e1", "a2d2"], rating: 1710, gameUrl: "https://lichess.org/ugqyRWZm#119", sourceReference: "https://database.lichess.org/#puzzles#00VIe" }
];

const referencePgn = (seed: ReferenceSeed, displayName: string): string => {
  const chess = new Chess(seed.fen);
  const fields = seed.fen.trim().split(/\s+/u);
  const startMove = Number(fields[5] ?? 1);
  const startsBlack = fields[1] === "b";
  let movetext = "";
  seed.solutionMoves.forEach((uci, index) => {
    const moveNumber = startMove + (startsBlack ? Math.floor((index + 1) / 2) : Math.floor(index / 2));
    if (startsBlack && index === 0) movetext += `${moveNumber}... `;
    else if ((!startsBlack && index % 2 === 0) || (startsBlack && index % 2 === 1)) movetext += `${moveNumber}. `;
    const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci.length > 4 ? { promotion: uci[4] } : {}) });
    movetext += `${move.san} `;
  });
  return `[Event "Mate Pattern Reference"]\n[Pattern "${displayName}"]\n[SetUp "1"]\n[FEN "${seed.fen}"]\n[Source "${seed.gameUrl ?? seed.sourceReference ?? "local dataset"}"]\n\n${movetext.trim()}`;
};

const referenceByFamily = new Map(referenceSeeds.map(seed => [seed.family, seed]));

/** External taxonomy metadata belongs in the application boundary, not domain rules. */
export const MATE_PATTERN_SOURCE_CATALOG: readonly MatePatternSourceMetadata[] = PATTERN_FAMILY_CATALOG.map(definition => {
  const sourceKey = definition.aliases[0] ?? definition.canonicalKey;
  return {
    family: definition.id,
    source: definition.tier === "MVP_NAMED_CORE" ? "LICHESS_MATE_THEME" : "EXTENDED_REFERENCE",
    sourceKey,
    ...(definition.tier === "MVP_NAMED_CORE" ? { trainingUrl: `https://lichess.org/training/${sourceKey}` } : {}),
    ...(referenceByFamily.get(definition.id) === undefined ? {} : {
      reference: (() => {
        const seed = referenceByFamily.get(definition.id)!;
        return {
          caseId: seed.caseId,
          fen: seed.fen,
          solutionMoves: seed.solutionMoves,
          pgn: referencePgn(seed, definition.displayName),
          rating: seed.rating,
          ...(seed.gameUrl === undefined ? {} : { gameUrl: seed.gameUrl }),
          ...(seed.sourceReference === undefined ? {} : { sourceReference: seed.sourceReference })
        };
      })()
    })
  };
});

export const LICHESS_MATE_PATTERN_CATALOG = MATE_PATTERN_SOURCE_CATALOG.filter(item => item.source === "LICHESS_MATE_THEME");

export type TacticalMotifSourceMetadata = Readonly<{
  motif: TacticalMotifId;
  source: "LICHESS_TACTICAL_THEME";
  sourceKey: string;
  trainingUrl: string;
}>;

export const TACTICAL_MOTIF_SOURCE_CATALOG: readonly TacticalMotifSourceMetadata[] = TACTICAL_MOTIF_CATALOG.map(definition => {
  const sourceKey = definition.aliases[0] ?? definition.canonicalKey;
  return {
    motif: definition.id,
    source: "LICHESS_TACTICAL_THEME",
    sourceKey,
    trainingUrl: `https://lichess.org/training/${sourceKey}`
  };
});
