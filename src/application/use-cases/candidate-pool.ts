import type { CandidateGenerator, CandidateGeneratorRequest } from "../ports/pattern-steering";
import type { MoveProvider } from "../ports/providers";
import type { ChessRulesPort } from "../ports/chess-rules";
import { domainError } from "../../domain/shared/errors";
import { err, isErr, ok } from "../../domain/shared/result";
import type { CandidateSeed } from "../../domain/scenario-lines/scenario-line";

export type CandidateGeneratorSource = Readonly<{
  generator: CandidateGenerator;
  budget: number;
  mandatory?: boolean;
}>;

/**
 * Builds a legal, provenance-preserving candidate pool from existing engines.
 * Providers are queried once per position and duplicate UCI moves are merged
 * while retaining every provider provenance record.
 */
export const candidateGeneratorFromProviders = (
  chess: ChessRulesPort,
  providers: readonly MoveProvider[]
): CandidateGenerator => async (request: CandidateGeneratorRequest) => {
  if (request.limit < 1) {
    return err(domainError("INVALID_HORIZON", "patternSteering.limit", "Candidate limit must be positive"));
  }
  const seen = new Set<string>();
  const candidates: CandidateSeed[] = [];
  for (const provider of providers.slice(0, request.limit)) {
    const provided = await provider({ position: request.position, lineId: request.lineId, ply: 1 });
    if (isErr(provided)) return err(provided.error);
    const legal = chess.parseLegalMove(request.position, provided.value.move.uci);
    if (isErr(legal)) return err(domainError("PROVIDER_ILLEGAL_MOVE", "patternSteering.candidatePool", "Candidate provider returned an illegal move", { uci: provided.value.move.uci, cause: legal.error }));
    const uci = String(legal.value.uci);
    if (!seen.has(uci)) {
      seen.add(uci);
      candidates.push({ tag: "CandidateSeed" as const, move: legal.value, provenance: provided.value.provenance, proposedBy: [provided.value.provenance] });
    }
  }
  return ok(candidates);
};

export const composeCandidateGenerators = (
  chess: ChessRulesPort,
  sources: readonly (CandidateGenerator | CandidateGeneratorSource)[]
): CandidateGenerator => {
  const composed = async (request: CandidateGeneratorRequest) => {
    const byUci = new Map<string, CandidateSeed>();
    const mandatoryUci = new Set<string>();
    const order: string[] = [];
    const defaultBudget = Math.max(1, Math.ceil(request.limit / Math.max(1, sources.length)));
    for (const source of sources) {
      const generator = typeof source === "function" ? source : source.generator;
      const budget = typeof source === "function" ? defaultBudget : Math.max(1, Math.floor(source.budget));
      const result = await generator({ ...request, limit: budget });
      if (isErr(result)) return err(result.error);
      for (const candidate of result.value) {
        const legal = chess.parseLegalMove(request.position, candidate.move.uci);
        if (isErr(legal)) return err(domainError("PROVIDER_ILLEGAL_MOVE", "patternSteering.composedPool", "Composed generator returned an illegal move", { uci: candidate.move.uci, cause: legal.error }));
        const uci = String(legal.value.uci);
        const existing = byUci.get(uci);
        if (existing !== undefined) {
          const proposedBy = [...(existing.proposedBy ?? [existing.provenance]), ...(candidate.proposedBy ?? [candidate.provenance])];
          const unique = proposedBy.filter((provenance, index, all) => all.findIndex(item => item.requestId === provenance.requestId) === index);
          byUci.set(uci, { ...existing, proposedBy: unique });
          if (typeof source !== "function" && source.mandatory === true) mandatoryUci.add(uci);
          continue;
        }
        byUci.set(uci, { tag: "CandidateSeed" as const, move: legal.value, provenance: candidate.provenance, proposedBy: candidate.proposedBy ?? [candidate.provenance] });
        order.push(uci);
        if (typeof source !== "function" && source.mandatory === true) mandatoryUci.add(uci);
      }
    }
    const mandatory = order.filter(uci => mandatoryUci.has(uci)).map(uci => byUci.get(uci)!).filter(Boolean);
    const exploration = order.filter(uci => !mandatoryUci.has(uci)).map(uci => byUci.get(uci)!).filter(Boolean);
    return ok([...mandatory, ...exploration].slice(0, request.limit));
  };
  return Object.assign(composed, { dispose: () => sources.forEach(source => (typeof source === "function" ? source.dispose?.() : source.generator.dispose?.())) });
};

export const candidateGeneratorFromMoveProvider = (provider: MoveProvider): CandidateGenerator => Object.assign(async (request: CandidateGeneratorRequest) => {
  const result = await provider({ position: request.position, lineId: request.lineId, ply: 1 });
  return isErr(result) ? err(result.error) : ok([{ tag: "CandidateSeed" as const, move: result.value.move, provenance: result.value.provenance }]);
}, { dispose: () => provider.dispose?.() });
