import type { ScenarioLine } from "../domain/scenario-lines/scenario-line";

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
  const target = trace?.candidates.find(candidate => candidate.uci === trace.selectedUci)?.targetFamily;
  const header = `## ${caseId} PatternSteeredTalPath${target === undefined ? "" : ` target ${target}`} status ${line.status}`;
  const movetext = formatSanMovetext(line);
  return `${header}\n${movetext.length === 0 ? "(no moves)" : movetext}\n\n`;
};
