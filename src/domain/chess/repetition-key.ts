import type { PositionSnapshot } from "./position";

/** FIDE repetition identity; move counters are not part of the position. */
export const repetitionKeyFromFen = (fen: string): string => String(fen).trim().split(/\s+/u).slice(0, 4).join(" ");
export const repetitionKey = (position: PositionSnapshot): string => repetitionKeyFromFen(String(position.fen));
