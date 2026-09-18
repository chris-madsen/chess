import type { ScenarioLine } from "../domain/scenario-lines/scenario-line";
import { MATE_PATTERN_SOURCE_CATALOG } from "../application/experiments/mate-pattern-catalog";
import { PATTERN_FAMILY_CATALOG } from "../domain/patterns/pattern";
import type { PatternFamilyId } from "../domain/patterns/pattern";
import type { PatternTargetSession } from "../application/use-cases/pattern-target-branching";
import { rankPatternTargets } from "../application/use-cases/pattern-target-branching";
import type { PositionSnapshot } from "../domain/chess/position";

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

export const renderPatternDiscoveryStart = (caseId: string, position: PositionSnapshot): string => {
  const preview: ScenarioLine = {
    tag: "ScenarioLine",
    mode: "HumanPath",
    label: "PatternSteeredTalPath",
    start: position,
    horizon: 0 as ScenarioLine["horizon"],
    plies: [],
    status: "Incomplete"
  };
  const movetext = formatSanMovetext(preview);
  return `## ${caseId} Pattern discovery status Running\n${movetext.length === 0 ? "(calculating first move...)" : movetext}\n\n`;
};

export const renderPatternReference = (line: ScenarioLine, minimumAffinityByFamily: ReadonlyMap<PatternFamilyId, number> = new Map()): string => {
  const maximumAffinityByFamily = new Map<PatternFamilyId, number>();
  for (const trace of line.decisionTraces ?? []) {
    const selected = trace.candidates.find(candidate => candidate.uci === trace.selectedUci);
    if (selected === undefined) continue;
    const previous = maximumAffinityByFamily.get(selected.targetFamily) ?? 0;
    maximumAffinityByFamily.set(selected.targetFamily, Math.max(previous, selected.afterMaiaAffinity));
  }
  minimumAffinityByFamily.forEach((affinity, family) => {
    const previous = maximumAffinityByFamily.get(family) ?? 0;
    maximumAffinityByFamily.set(family, Math.max(previous, affinity));
  });
  const patterns = [...maximumAffinityByFamily.entries()]
    .map(([family, affinity]) => ({ family, affinity }))
    .sort((first, second) => second.affinity - first.affinity || first.family.localeCompare(second.family));
  const selectedPattern = patterns[0];
  if (selectedPattern === undefined) return "";
  const source = MATE_PATTERN_SOURCE_CATALOG.find(item => item.family === selectedPattern.family);
  const reference = source?.reference;
  const displayName = PATTERN_FAMILY_CATALOG.find(item => item.id === selectedPattern.family)?.displayName ?? selectedPattern.family;
  const affinity = `${(Math.max(0, Math.min(1, selectedPattern.affinity)) * 100).toFixed(1)}%`;
  const patternList = patterns.map((pattern, index) => {
    const name = PATTERN_FAMILY_CATALOG.find(item => item.id === pattern.family)?.displayName ?? pattern.family;
    const percent = `${(Math.max(0, Math.min(1, pattern.affinity)) * 100).toFixed(1)}%`;
    return `${index + 1}. ${name} (${pattern.family}) ${percent}`;
  });
  if (reference === undefined) return [
    "Pattern reference",
    "Patterns observed:",
    ...patternList,
    "",
    `Reference unavailable for ${selectedPattern.family}`,
    "",
  ].join("\n");
  const trainingUrl = source?.trainingUrl;
  return [
    "Pattern reference",
    `${displayName} (${selectedPattern.family}), affinity ${affinity}`,
    "",
    "Patterns observed:",
    ...patternList,
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

const targetDisplayName = (family: PatternFamilyId): string => PATTERN_FAMILY_CATALOG.find(item => item.id === family)?.displayName ?? family;

const combinedTargetLine = (session: PatternTargetSession, target: NonNullable<PatternTargetSession["targets"][number]>, line: ScenarioLine): ScenarioLine => ({
  ...line,
  start: session.discovery.start,
  horizon: session.discovery.horizon,
  plies: [...target.prefixPlies, ...line.plies]
});

export const renderPatternTargetSession = (caseId: string, session: PatternTargetSession): string => {
  const output: string[] = [];
  output.push(`## ${caseId} Pattern discovery status ${session.discovery.status}`);
  output.push(formatSanMovetext(session.discovery).length === 0 ? "(calculating first move...)" : formatSanMovetext(session.discovery));
  output.push("");
  for (const target of rankPatternTargets(session.targets)) {
    const line = target.line;
    if (line === undefined) {
      const prefixLine: ScenarioLine = { ...session.discovery, plies: target.prefixPlies, status: "Incomplete", targetFamily: target.targetFamily };
      output.push(`## ${caseId} Target ${targetDisplayName(target.targetFamily)} (${target.targetFamily}) ${Math.round(target.triggerAffinity * 1000) / 10}% status Running`, formatSanMovetext(prefixLine), "");
      continue;
    }
    const combined = combinedTargetLine(session, target, line);
    output.push(`## ${caseId} Target ${targetDisplayName(target.targetFamily)} (${target.targetFamily}) status ${line.status}`, formatSanMovetext(combined), "");
  }
  return `${output.join("\n")}\n`;
};

export const renderPatternTargetReferences = (caseId: string, session: PatternTargetSession): string => {
  const output = ["", "########", `Pattern references for ${caseId}`, ""];
  const targets = rankPatternTargets(session.targets);
  if (targets.length === 0) {
    output.push("No target reached 97%.", "");
    return `${output.join("\n")}########\n`;
  }
  for (const target of targets) {
    output.push(`Target ${targetDisplayName(target.targetFamily)} (${target.targetFamily}), trigger affinity ${(target.triggerAffinity * 100).toFixed(1)}%`);
    if (target.line === undefined) {
      output.push("status: Incomplete", "reference unavailable because the target branch did not finish", "");
      continue;
    }
    output.push(renderPatternReference(target.line, new Map([[target.targetFamily, target.triggerAffinity]])));
  }
  output.push("########", "");
  return output.join("\n");
};
