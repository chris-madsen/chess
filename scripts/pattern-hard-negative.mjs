import { Chess } from "chess.js";

const policyFor = (family, attacker) => {
  const defender = attacker === "w" ? "b" : "w";
  return new Map([
    ["ANASTASIA", { color: attacker, types: ["n"] }],
    ["ARABIAN", { color: attacker, types: ["r", "q"] }],
    ["BACK_RANK", { color: defender, types: ["p"] }],
    ["BODEN", { color: attacker, types: ["b"] }],
    ["SMOTHERED", { color: defender, types: ["q", "r", "b", "n", "p"] }]
  ]).get(family) ?? { color: attacker, types: ["q", "r", "b", "n", "p"] };
};

export const controlledHardNegative = (fen, family) => {
  try {
    const game = new Chess(fen);
    const policy = policyFor(family, game.turn());
    const target = game.board().flat().find(piece => piece !== null && piece.color === policy.color && policy.types.includes(piece.type));
    if (target === undefined || target === null) return undefined;
    game.remove(target.square);
    const mutatedFen = game.fen();
    if (mutatedFen === fen || game.isCheckmate()) return undefined;
    return { fen: mutatedFen, transformation: "REMOVE_CRITICAL_PIECE", square: target.square, piece: `${target.color}${target.type}` };
  } catch {
    return undefined;
  }
};
