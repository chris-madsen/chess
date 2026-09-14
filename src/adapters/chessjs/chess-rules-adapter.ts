import { createHash } from "node:crypto";
import { Chess, type Move } from "chess.js";
import type { ChessRulesPort } from "../../application/ports/chess-rules";
import type { LegalMove } from "../../domain/chess/moves";
import type { PositionSnapshot, UciPositionCommand } from "../../domain/chess/position";
import {
  makeFen,
  makePositionHash,
  makeSanMove,
  makeUciMove,
  type Fen,
  type PositionHash,
  type Side,
  type UciMove
} from "../../domain/chess/value-objects";
import type { PositionFacts, MaterialInventory } from "../../domain/position-intelligence/facts";
import { domainError, type DomainError } from "../../domain/shared/errors";
import { err, ok, type Result } from "../../domain/shared/result";

const sideFromTurn = (turn: "w" | "b"): Side => (turn === "w" ? "white" : "black");

const uciFromMove = (move: Move): string => `${move.from}${move.to}${move.promotion ?? ""}`;

const toLegalMove = (move: Move): LegalMove => ({
  tag: "LegalMove",
  san: makeSanMove(move.san),
  uci: makeUciMove(uciFromMove(move)),
  from: move.from,
  to: move.to,
  promotion: move.promotion ?? null
});


const stripRawGameNoise = (rawGame: string): string => rawGame
  .replace(/\{[^}]*\}/g, " ")
  .replace(/;[^\n\r]*/g, " ")
  .replace(/\([^)]*\)/g, " ")
  .replace(/\$\d+/g, " ")
  .replace(/\b\d+\.(\.\.)?/g, " ")
  .replace(/\b(?:1-0|0-1|1\/2-1\/2|\*)\b/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const applyRawSanGame = (rawGame: string): Result<Readonly<{ chess: Chess; uciMoves: readonly UciMove[] }>, DomainError> => {
  const chess = new Chess();
  const uciMoves: UciMove[] = [];
  const cleaned = stripRawGameNoise(rawGame);
  if (cleaned.length === 0) {
    return ok({ chess, uciMoves });
  }
  const tokens = cleaned.split(" ").filter(Boolean);
  for (const [index, token] of tokens.entries()) {
    try {
      const move = chess.move(token);
      uciMoves.push(makeUciMove(uciFromMove(move)));
    } catch (error) {
      return err(domainError("INVALID_RAW_GAME", `rawGame.moves.${index + 1}`, "RAW SAN game contains an illegal or unparseable move", {
        token,
        cause: error instanceof Error ? error.message : String(error)
      }));
    }
  }
  return ok({ chess, uciMoves });
};

const makeChess = (fen: string, path: string): Result<Chess, DomainError> => {
  try {
    return ok(new Chess(fen));
  } catch (error) {
    return err(domainError("INVALID_FEN", path, "Invalid FEN", { cause: error instanceof Error ? error.message : String(error) }));
  }
};

const legalMovesFromChess = (chess: Chess): readonly LegalMove[] => chess.moves({ verbose: true }).map(toLegalMove);

const snapshotFromChess = (
  chess: Chess,
  hashFen: (fen: Fen) => PositionHash,
  uciPosition?: UciPositionCommand
): PositionSnapshot => {
  const fen = makeFen(chess.fen());
  return {
    tag: "PositionSnapshot",
    fen,
    sideToMove: sideFromTurn(chess.turn()),
    hash: hashFen(fen),
    legalMoves: legalMovesFromChess(chess),
    uciPosition: uciPosition ?? { base: "fen", fen, moves: [] }
  };
};

const parseUciObject = (rawMove: string): { from: string; to: string; promotion?: string } | null => {
  const normalized = rawMove.trim().toLowerCase();
  const match = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(normalized);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    return null;
  }
  return match[3] === undefined
    ? { from: match[1], to: match[2] }
    : { from: match[1], to: match[2], promotion: match[3] };
};

const tryMove = (chess: Chess, rawMove: string): Move | null => {
  const uci = parseUciObject(rawMove);
  try {
    return uci === null ? chess.move(rawMove.trim()) : chess.move(uci);
  } catch {
    return null;
  }
};

const emptyMaterial = (): MaterialInventory => ({
  white: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
  black: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 }
});

const materialFromChess = (chess: Chess): MaterialInventory => {
  const material = emptyMaterial();
  chess.board().flat().forEach(piece => {
    if (piece === null) {
      return;
    }
    const side = piece.color === "w" ? "white" : "black";
    const nextCount = (material[side][piece.type] ?? 0) + 1;
    (material[side] as Record<string, number>)[piece.type] = nextCount;
  });
  return material;
};

const isMoveCheck = (fen: string, move: Move): boolean => {
  const chess = new Chess(fen);
  const moveInput = move.promotion === undefined
    ? { from: move.from, to: move.to }
    : { from: move.from, to: move.to, promotion: move.promotion };
  chess.move(moveInput);
  return chess.isCheck();
};

export const createChessJsRulesAdapter = (): ChessRulesPort => {
  const hashFen = (fen: Fen): PositionHash => makePositionHash(createHash("sha256").update(String(fen)).digest("hex"));

  return {
    hashFen,
    ingestPosition: (rawFen: string): Result<PositionSnapshot, DomainError> => {
      const chessResult = makeChess(rawFen, "position.fen");
      return chessResult.tag === "Err" ? chessResult : ok(snapshotFromChess(chessResult.value, hashFen));
    },
    ingestRawGame: (rawGame: string): Result<PositionSnapshot, DomainError> => {
      const chessResult = applyRawSanGame(rawGame);
      return chessResult.tag === "Err"
        ? chessResult
        : ok(snapshotFromChess(chessResult.value.chess, hashFen, { base: "startpos", moves: chessResult.value.uciMoves }));
    },
    parseLegalMove: (position: PositionSnapshot, rawMove: string): Result<LegalMove, DomainError> => {
      const chessResult = makeChess(position.fen, "position.fen");
      if (chessResult.tag === "Err") {
        return chessResult;
      }
      const move = tryMove(chessResult.value, rawMove);
      return move === null
        ? err(domainError("ILLEGAL_MOVE", "move", "Move is not legal in the supplied position", { move: rawMove, fen: position.fen }))
        : ok(toLegalMove(move));
    },
    applyMove: (position: PositionSnapshot, move: LegalMove): Result<PositionSnapshot, DomainError> => {
      const chessResult = makeChess(position.fen, "position.fen");
      if (chessResult.tag === "Err") {
        return chessResult;
      }
      const applied = tryMove(chessResult.value, move.uci);
      if (applied === null) {
        return err(domainError("ILLEGAL_MOVE", "move", "Cannot apply illegal move", { move: move.uci, fen: position.fen }));
      }
      const uciPosition = {
        ...position.uciPosition,
        moves: [...position.uciPosition.moves, makeUciMove(uciFromMove(applied))]
      };
      return ok(snapshotFromChess(chessResult.value, hashFen, uciPosition));
    },
    computeFacts: (position: PositionSnapshot): Result<PositionFacts, DomainError> => {
      const chessResult = makeChess(position.fen, "position.fen");
      if (chessResult.tag === "Err") {
        return chessResult;
      }
      const chess = chessResult.value;
      const verboseMoves = chess.moves({ verbose: true });
      const legalChecks = verboseMoves.filter(move => isMoveCheck(position.fen, move)).map(toLegalMove);
      const legalCaptures = verboseMoves.filter(move => move.captured !== undefined || move.flags.includes("c") || move.flags.includes("e")).map(toLegalMove);
      const isCheck = chess.isCheck();
      const isCheckmate = chess.isCheckmate();
      const isStalemate = chess.isStalemate();
      const isDraw = chess.isDraw();
      const tacticalNotes = [
        ...(legalChecks.length > 0 ? [`${legalChecks.length} legal check(s) available`] : []),
        ...(legalCaptures.length > 0 ? [`${legalCaptures.length} legal capture(s) available`] : []),
        ...(isCheck ? ["Side to move is in check"] : [])
      ];
      return ok({
        tag: "PositionFacts",
        sideToMove: sideFromTurn(chess.turn()),
        material: materialFromChess(chess),
        legalChecks,
        legalCaptures,
        isCheck,
        isCheckmate,
        isStalemate,
        isDraw,
        isTerminal: isCheckmate || isStalemate || isDraw,
        tacticalNotes
      });
    }
  };
};
