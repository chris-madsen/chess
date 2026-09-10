import type { SanMove, UciMove } from "./value-objects";

export type MoveNotation = "SAN" | "UCI";

export type LegalMove = Readonly<{
  tag: "LegalMove";
  san: SanMove;
  uci: UciMove;
  from: string;
  to: string;
  promotion: string | null;
}>;
