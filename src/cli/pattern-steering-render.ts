import type { ScenarioLine } from "../domain/scenario-lines/scenario-line";
import { MATE_PATTERN_SOURCE_CATALOG } from "../application/experiments/mate-pattern-catalog";
import { PATTERN_FAMILY_CATALOG } from "../domain/patterns/pattern";

const wrapMovetext = (text: string, width = 72): string => {
  const words = text.split(/\s+/u).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line.length === 0 ? word : `${line} ${word}`;
    if (next.length > width && line.length > 0) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines.join("\n");
};

const rawSanTokens = (rawGame: string): readonly string[] => rawGame
  .replace(/\{[^}]*\}/g, " ")
  .replace(/;[^\n\r]*/g, " ")
  .replace(/\([^)]*\)/g, " ")
  .replace(/\$\d+/g, " ")
  .replace(/\b\d+\.(\.\.)?/g, " ")
  .replace(/\b(?:1-0|0-1|1\/2-1\/2|\*)\b/g, " ")
  .split(/\s+/u)
  .filter(Boolean);

const formatSanMovetext = (line: ScenarioLine): string => {
  const fields = String(line.start.fen).split(/\s+/u);
  const prefix = line.start.pgn === undefined ? [] : rawSanTokens(line.start.pgn);
  let fullmove = prefix.length > 0 ? 1 : Number(fields[5] ?? 1);
  if (!Number.isInteger(fullmove) || fullmove < 1) fullmove = 1;
  let side: "white" | "black" = prefix.length > 0 ? "white" : fields[1] === "b" ? "black" : "white";
  const chunks: string[] = [];
  const sanMoves = [...prefix, ...line.plies.map(ply => String(ply.move.san))];
  for (const san of sanMoves) {
    if (side === "white") {
      chunks.push(`${fullmove}. ${san}`);
      side = "black";
    } else {
      if (chunks.length === 0) chunks.push(`${fullmove}... ${san}`);
      else chunks[chunks.length - 1] = `${chunks[chunks.length - 1]} ${san}`;
      fullmove += 1;
      side = "white";
    }
  }
  return wrapMovetext(chunks.join(" "));
};

export const renderPatternSteeringLine = (caseId: string, line: ScenarioLine): string => {
  const trace = line.decisionTraces?.at(-1);
  const selected = trace?.candidates.find(candidate => candidate.uci === trace.selectedUci);
  const pattern = selected === undefined
    ? ""
    : ` pattern ${selected.targetFamily} ${(Math.max(0, Math.min(1, selected.afterMaiaAffinity)) * 100).toFixed(1)}%`;
  const header = `## ${caseId} PatternSteeredTalPath${pattern} status ${line.status}`;
  const movetext = formatSanMovetext(line);
  return `${header}\n${movetext.length === 0 ? "(no moves)" : movetext}\n\n`;
};

export const renderPatternReference = (line: ScenarioLine): string => {
  const trace = line.decisionTraces?.at(-1);
  const selected = trace?.candidates.find(candidate => candidate.uci === trace.selectedUci);
  if (selected === undefined) return "";
  const source = MATE_PATTERN_SOURCE_CATALOG.find(item => item.family === selected.targetFamily);
  const reference = source?.reference;
  if (reference === undefined) return `Pattern reference unavailable for ${selected.targetFamily}\n\n`;
  const displayName = PATTERN_FAMILY_CATALOG.find(item => item.id === selected.targetFamily)?.displayName ?? selected.targetFamily;
  const affinity = `${(Math.max(0, Math.min(1, selected.afterMaiaAffinity)) * 100).toFixed(1)}%`;
  const trainingUrl = source?.trainingUrl;
  return [
    "Pattern reference",
    `${displayName} (${selected.targetFamily}), affinity ${affinity}`,
    "",
    "Reference PGN:",
    reference.pgn,
    "",
    ...(trainingUrl === undefined ? [] : [`Lichess theme: ${trainingUrl}`]),
    ...(reference.gameUrl === undefined ? [] : [`Example: ${reference.gameUrl}`]),
    ...(reference.sourceReference === undefined ? [] : [`Dataset source: ${reference.sourceReference}`]),
    `Dataset case: ${reference.caseId}, rating ${reference.rating}`,
    "",
  ].join("\n");
};
