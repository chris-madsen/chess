import type { ChessRulesPort } from "../ports/chess-rules";
import type { LegalMove } from "../../domain/chess/moves";
import type { PositionSnapshot } from "../../domain/chess/position";
import type { Side } from "../../domain/chess/value-objects";
import type { PositionFacts } from "../../domain/position-intelligence/facts";
import type { ScenarioLine } from "../../domain/scenario-lines/scenario-line";
import type { PatternFamilyId } from "../../domain/patterns/pattern";
import type { CausalMoveContribution, LessonProfile, SacrificeMotif, SacrificeProfile, SacrificeType } from "../../domain/lessons/lesson-profile";
import { lessonMotifName, type LessonTacticalMotifId, type TacticalMotif } from "../../domain/lessons/tactical-motifs";
import { isErr } from "../../domain/shared/result";
import { calibratedAttractorScore } from "../../domain/patterns/thresholds";

type BoardPiece = Readonly<{ side: Side; type: string; square: string }>;
const pieceValues: Readonly<Record<string, number>> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

const boardFromFen = (fen: string): readonly BoardPiece[] => {
  const board: BoardPiece[] = [];
  let rank = 8;
  let file = 0;
  for (const token of fen.split(/\s+/u)[0] ?? "") {
    if (token === "/") { rank -= 1; file = 0; continue; }
    if (/^[1-8]$/u.test(token)) { file += Number(token); continue; }
    if ("pnbrqk".includes(token.toLowerCase())) {
      board.push({ side: token === token.toUpperCase() ? "white" : "black", type: token.toLowerCase(), square: `${String.fromCharCode(97 + file)}${rank}` });
      file += 1;
    }
  }
  return board;
};

const pieceAt = (board: readonly BoardPiece[], square: string): BoardPiece | undefined => board.find(piece => piece.square === square);
const materialValue = (facts: PositionFacts, side: Side): number => Object.entries(facts.material[side]).reduce((sum, [type, count]) => sum + (pieceValues[type] ?? 0) * count, 0);
const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const round = (value: number): number => Number(clamp(value).toFixed(4));
const fullMoveNumber = (position: PositionSnapshot): number => {
  const raw = Number(String(position.fen).split(/\s+/u)[5] ?? 1);
  return Number.isInteger(raw) && raw > 0 ? raw : 1;
};
const attackerMove = (position: PositionSnapshot, attacker: Side): boolean => position.sideToMove === attacker;
const hasMove = (moves: readonly LegalMove[], uci: string): boolean => moves.some(move => String(move.uci) === uci);
const movePiece = (position: PositionSnapshot, move: LegalMove): BoardPiece | undefined => pieceAt(boardFromFen(String(position.fen)), move.from);
const moveIsCapture = (facts: PositionFacts, move: LegalMove): boolean => hasMove(facts.legalCaptures, String(move.uci));
const capturedValueAt = (facts: PositionFacts, move: LegalMove, board: readonly BoardPiece[]): number => {
  if (!moveIsCapture(facts, move)) return 0;
  return pieceValues[pieceAt(board, move.to)?.type ?? ""] ?? 0;
};

const sacrificeType = (piece: BoardPiece | undefined, capturedValue = 0): SacrificeType => {
  if (piece?.type === "q") return "QUEEN";
  if (piece?.type === "r") return capturedValue > 0 && capturedValue < 5 ? "EXCHANGE" : "ROOK";
  if (piece?.type === "b" || piece?.type === "n") return "MINOR";
  return "PAWN";
};

const motifForSacrifice = (givesCheck: boolean, laterDependencyCount: number, opensLineToKing: boolean): SacrificeMotif => {
  if (givesCheck) return "KING_EXPOSURE";
  if (opensLineToKing) return "LINE_OPENING";
  if (laterDependencyCount > 0) return "REMOVAL_OF_DEFENDER";
  return "OTHER";
};

const patternData = (line: ScenarioLine): Readonly<{ scores: ReadonlyMap<PatternFamilyId, number>; families: readonly PatternFamilyId[]; primary?: PatternFamilyId }> => {
  const scores = new Map<PatternFamilyId, number>();
  const latest = new Map<PatternFamilyId, number>();
  for (const trace of line.decisionTraces ?? []) {
    const selected = trace.candidates.find(candidate => candidate.uci === trace.selectedUci);
    if (selected === undefined) continue;
    const calibrated = calibratedAttractorScore(selected.afterMaiaAffinity, selected.targetFamily);
    scores.set(selected.targetFamily, Math.max(scores.get(selected.targetFamily) ?? 0, calibrated));
    latest.set(selected.targetFamily, calibrated);
  }
  for (const [family, value] of latest) scores.set(family, scores.get(family) === undefined ? value : scores.get(family)! * 0.4 + value * 0.6);
  const families = [...scores.entries()].filter(([, score]) => score >= 0.5).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([family]) => family);
  return { scores, families, ...(families[0] === undefined ? {} : { primary: families[0] }) };
};

const selectedCandidate = (line: ScenarioLine, ply: number): Readonly<{ afterMaiaAffinity: number; mateClass?: boolean }> | undefined => {
  const trace = line.decisionTraces?.[ply];
  if (trace === undefined) return undefined;
  return trace.candidates.find(candidate => candidate.uci === trace.selectedUci);
};

const motif = (id: LessonTacticalMotifId, ply: number): TacticalMotif => ({ id, displayName: lessonMotifName(id), ply });

export const analyzeLessonLine = (
  chess: ChessRulesPort,
  line: ScenarioLine,
  options: Readonly<{ forcedMateStatus?: LessonProfile["forcedMateStatus"]; lineId?: string; fullRootToTerminalPlies?: number; decisionTraceOffset?: number }> = {}
): LessonProfile => {
  const attacker = line.start.sideToMove;
  let current = line.start;
  const positions: PositionSnapshot[] = [current];
  const factsBefore: PositionFacts[] = [];
  const factsAfter: PositionFacts[] = [];
  const validPlies: typeof line.plies[number][] = [];
  const moves = line.plies.map(ply => ply.move);
  const attackerContributions: CausalMoveContribution[] = [];
  const sacrifices: SacrificeProfile[] = [];
  const motifs: TacticalMotif[] = [];
  let checks = 0;
  let captures = 0;
  let forcingReplies = 0;
  let mateClassCount = 0;
  let finalMateMoveNumber: number | undefined;
  for (const ply of line.plies) {
    const beforeFacts = chess.computeFacts(current);
    if (isErr(beforeFacts)) break;
    const next = chess.applyMove(current, ply.move);
    if (isErr(next)) break;
    const afterFacts = chess.computeFacts(next.value);
    if (isErr(afterFacts)) break;
    factsBefore.push(beforeFacts.value);
    factsAfter.push(afterFacts.value);
    validPlies.push(ply);
    current = next.value;
    positions.push(current);
  }
  current = positions.at(-1) ?? line.start;
  let attackerDecisionIndex = 0;
  for (let moveIndex = 0; moveIndex < validPlies.length; moveIndex += 1) {
    const ply = validPlies[moveIndex]!;
    const before = positions[moveIndex]!;
    const beforeFacts = factsBefore[moveIndex]!;
    const next = positions[moveIndex + 1]!;
    const afterFacts = factsAfter[moveIndex]!;
    const isAttackerAtPly = attackerMove(before, attacker);
    const givesCheck = isAttackerAtPly && afterFacts.isCheck;
    const capturesMove = isAttackerAtPly && moveIsCapture(beforeFacts, ply.move);
    if (givesCheck) { checks += 1; motifs.push(motif("KING_HUNT", Number(ply.index))); }
    if (capturesMove) { captures += 1; }
    const selected = isAttackerAtPly ? selectedCandidate(line, attackerDecisionIndex - (options.decisionTraceOffset ?? 0)) : undefined;
    if (selected?.mateClass === true) mateClassCount += 1;
    if (givesCheck && next.legalMoves.length <= 3) forcingReplies += 1;
    if (isAttackerAtPly) {
      attackerDecisionIndex += 1;
      const piece = movePiece(before, ply.move);
      const laterMoves = moves.slice(moveIndex + 1).filter((candidate, index) => {
        const laterPosition = positions[moveIndex + index + 1];
        return laterPosition !== undefined && attackerMove(laterPosition, attacker) && (candidate.from === ply.move.to || candidate.to === ply.move.to);
      });
      const laterDependencyCount = laterMoves.length;
      let trackedSquare = ply.move.to;
      let capturedByTrackedPiece = capturedValueAt(beforeFacts, ply.move, boardFromFen(String(before.fen)));
      let capturedValue = 0;
      let replyCapturesMovedPiece = false;
      for (let futureIndex = moveIndex + 1; futureIndex < Math.min(validPlies.length, moveIndex + 10); futureIndex += 1) {
        const future = validPlies[futureIndex]!;
        const futureBefore = factsBefore[futureIndex]!;
        const futureBoard = boardFromFen(String(positions[futureIndex]!.fen));
        if (attackerMove(positions[futureIndex]!, attacker)) {
          if (future.move.from === trackedSquare) {
            capturedByTrackedPiece += capturedValueAt(futureBefore, future.move, futureBoard);
            trackedSquare = future.move.to;
          }
        } else if (future.move.to === trackedSquare) {
          replyCapturesMovedPiece = true;
          capturedValue = pieceValues[piece?.type ?? "p"] ?? 1;
          break;
        }
      }
      const capturedAtOriginalSquare = validPlies.slice(moveIndex + 1, moveIndex + 10).some(future => future.move.to === ply.move.to);
      replyCapturesMovedPiece = replyCapturesMovedPiece || capturedAtOriginalSquare;
      if (replyCapturesMovedPiece && capturedValue === 0) capturedValue = pieceValues[piece?.type ?? "p"] ?? 1;
      const investedValue = Math.max(0, capturedValue - capturedByTrackedPiece);
      const materialDrop = replyCapturesMovedPiece && investedValue >= 1.5;
      const opensLineToKing = piece !== undefined && ["r", "b", "q"].includes(piece.type) && laterMoves.some(move => move.from === ply.move.to || move.to === ply.move.to);
      const patternRoleUsedLater = laterDependencyCount > 0;
      const causal = materialDrop && (givesCheck || laterDependencyCount > 0 || afterFacts.isTerminal);
      const defenderKing = boardFromFen(String(before.fen)).find(item => item.side !== attacker && item.type === "k");
      const kingMovesBefore = defenderKing === undefined ? 0 : before.legalMoves.filter(move => move.from === defenderKing.square).length;
      const afterDefenderKing = boardFromFen(String(next.fen)).find(item => item.side !== attacker && item.type === "k");
      const kingMovesAfter = afterDefenderKing === undefined ? 0 : next.legalMoves.filter(move => move.from === afterDefenderKing.square).length;
      const contribution: CausalMoveContribution = {
        ply: Number(ply.index), move: ply.move.uci, createsThreat: givesCheck || capturesMove,
        givesCheck, captures: capturesMove, opensLineToKing, removesDefender: capturesMove && givesCheck && laterDependencyCount > 0,
        activatesPatternRole: opensLineToKing || patternRoleUsedLater, patternRoleUsedLater,
        restrictsKingMobilityDelta: Math.max(0, kingMovesBefore - kingMovesAfter),
        attractorDelta: (selected?.afterMaiaAffinity ?? 0) - (line.decisionTraces?.[Math.max(0, attackerDecisionIndex - 2 - (options.decisionTraceOffset ?? 0))]?.candidates.find(candidate => candidate.uci === line.decisionTraces?.[Math.max(0, attackerDecisionIndex - 2 - (options.decisionTraceOffset ?? 0))]?.selectedUci)?.afterMaiaAffinity ?? 0),
        laterDependencyCount,
        ...(afterFacts.isCheckmate ? { mateDistanceDelta: 0 } : {})
      };
      attackerContributions.push(contribution);
      if (materialDrop) {
        const type = sacrificeType(piece, capturedByTrackedPiece);
        sacrifices.push({ ply: Number(ply.index), type, causal, soundOrForced: causal && (givesCheck || afterFacts.isTerminal), ...(afterFacts.isCheckmate ? { mateDistanceAfterSacrifice: 0 } : {}), motif: motifForSacrifice(givesCheck, laterDependencyCount, opensLineToKing) });
        motifs.push(motif(type === "QUEEN" ? "QUEEN_SACRIFICE" : type === "ROOK" ? "ROOK_SACRIFICE" : type === "EXCHANGE" ? "EXCHANGE_SACRIFICE" : type === "MINOR" ? "MINOR_SACRIFICE" : "PAWN_SACRIFICE", Number(ply.index)));
      }
      if (opensLineToKing) motifs.push(motif("LINE_OPENING", Number(ply.index)));
      if (capturesMove && givesCheck && laterDependencyCount > 0) motifs.push(motif("REMOVAL_OF_DEFENDER", Number(ply.index)));
    }
    if (afterFacts.isCheckmate) finalMateMoveNumber = fullMoveNumber(next) - (next.sideToMove === "white" ? 1 : 0);
  }
  const terminalFacts = chess.computeFacts(current);
  const humanPathMate = !isErr(terminalFacts) && terminalFacts.value.isCheckmate;
  const hashes = positions.map(position => String(position.hash));
  const repetitionCount = hashes.length - new Set(hashes).size;
  const nonProgressMoveCount = attackerContributions.filter(item => !item.givesCheck && !item.captures && !item.patternRoleUsedLater && item.laterDependencyCount === 0).length;
  const lastThird = attackerContributions.filter(item => item.ply > Math.floor(Math.max(1, line.plies.length) * 2 / 3));
  const lastMaterial = !isErr(terminalFacts) ? materialValue(terminalFacts.value, "white") + materialValue(terminalFacts.value, "black") : 0;
  const technicalEndgamePenalty = line.plies.length > 20 && lastMaterial <= 18 && lastThird.filter(item => !item.givesCheck && !item.captures).length >= 3 ? clamp((line.plies.length - 20) / 30 + 0.35) : 0;
  const promotions = line.plies.filter(ply => ply.move.promotion !== null);
  const firstPromotionIndex = promotions[0] === undefined ? undefined : Number(promotions[0].index);
  const pliesAfterPromotion = firstPromotionIndex === undefined ? 0 : Math.max(0, validPlies.length - firstPromotionIndex - 1);
  const postPromotionChecks = firstPromotionIndex === undefined ? 0 : attackerContributions.filter(item => item.ply > firstPromotionIndex && item.givesCheck).length;
  const promotionGrindPenalty = firstPromotionIndex !== undefined && pliesAfterPromotion >= 8
    ? clamp((pliesAfterPromotion - postPromotionChecks * 2) / 20)
    : 0;
  const pattern = patternData(line);
  const patternClarity = round(Math.max(...[...pattern.scores.values(), 0]));
  const forcingness = round((line.plies.length === 0 ? 0 : checks / Math.max(1, attackerContributions.length)) * 0.45 + (line.plies.length === 0 ? 0 : captures / Math.max(1, attackerContributions.length)) * 0.2 + (attackerContributions.length === 0 ? 0 : forcingReplies / attackerContributions.length) * 0.2 + (attackerContributions.length === 0 ? 0 : mateClassCount / attackerContributions.length) * 0.15);
  const causalPreparation = round(attackerContributions.length === 0 ? 0 : attackerContributions.filter(item => item.laterDependencyCount > 0 || item.givesCheck || item.captures).length / attackerContributions.length);
  const pieceCoordination = round(attackerContributions.length === 0 ? 0 : attackerContributions.filter(item => item.patternRoleUsedLater || item.activatesPatternRole).length / attackerContributions.length);
  const causalSacrifices = sacrifices.filter(item => item.causal).length;
  const combinationBeauty = round(forcingness * 0.32 + causalPreparation * 0.25 + pieceCoordination * 0.15 + patternClarity * 0.18 + Math.min(1, causalSacrifices / 2) * 0.1 - technicalEndgamePenalty * 0.2 - promotionGrindPenalty * 0.2 - Math.min(1, repetitionCount / 3) * 0.15);
  const generatedFullMoves = Math.ceil(line.plies.length / 2);
  const longLine = generatedFullMoves > 35;
  const suppressed = !humanPathMate || repetitionCount > 0 || (longLine && technicalEndgamePenalty > 0.45) || promotionGrindPenalty > 0.45;
  const qualityTier: LessonProfile["qualityTier"] = suppressed ? "SUPPRESSED" : generatedFullMoves <= 30 && forcingness >= 0.5 && (causalSacrifices > 0 || causalPreparation >= 0.5) ? "A" : generatedFullMoves <= 30 && patternClarity >= 0.75 ? "B" : generatedFullMoves <= 35 && combinationBeauty >= 0.55 ? "C" : generatedFullMoves <= 35 && patternClarity >= 0.65 ? "D" : "E";
  const eligible = humanPathMate && line.status !== "Incomplete" && qualityTier !== "SUPPRESSED";
  const lessonUtility = round(combinationBeauty * 0.62 + patternClarity * 0.18 + forcingness * 0.15 + (eligible ? 0.05 : -0.2) - technicalEndgamePenalty * 0.35 - promotionGrindPenalty * 0.25 - Math.min(1, repetitionCount / 3) * 0.2);
  const reasons = [
    ...(causalSacrifices > 0 ? [`${causalSacrifices} causal sacrifice${causalSacrifices === 1 ? "" : "s"}`] : []),
    ...(forcingness >= 0.5 ? ["forcing attack"] : []),
    ...(patternClarity >= 0.75 ? ["clear mating finish"] : []),
    ...(line.plies.length <= 14 ? ["short conversion"] : []),
    ...(repetitionCount === 0 ? ["no repetition"] : [])
  ];
  const penalties = [
    ...(technicalEndgamePenalty > 0 ? ["technical endgame conversion"] : []),
    ...(promotionGrindPenalty > 0 ? ["promotion grind"] : []),
    ...(repetitionCount > 0 ? ["repeated positions"] : []),
    ...(nonProgressMoveCount > 4 ? ["many non-progress moves"] : [])
  ];
  return {
    lineId: options.lineId ?? line.label,
    generatedPlies: line.plies.length,
    generatedFullMoves,
    inputFinalMoveNumber: fullMoveNumber(line.start),
    ...(finalMateMoveNumber === undefined ? {} : { finalMateMoveNumber }),
    ...(options.fullRootToTerminalPlies === undefined ? {} : { fullRootToTerminalPlies: options.fullRootToTerminalPlies }),
    humanPathMate, forcedMateStatus: options.forcedMateStatus ?? "UNAVAILABLE", mateFamilies: pattern.families,
    ...(pattern.primary === undefined ? {} : { primaryMateFamily: pattern.primary }), patternClarity,
    sacrifices, forcingness, causalPreparation, pieceCoordination, repetitionCount, nonProgressMoveCount,
    technicalEndgamePenalty, promotionGrindPenalty, combinationBeauty, lessonUtility, qualityTier,
    motifs, causalMoves: attackerContributions, eligible, reasons, penalties
  };
};
