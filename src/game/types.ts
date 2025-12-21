export type Side = "W" | "B";
export type PieceType = "K" | "Q" | "R" | "B" | "N" | "P";

export type Square = { r: number; c: number };

export type Piece = {
  id: string;
  side: Side;
  type: PieceType;
  pos: Square;
  alive: boolean;

  // Star heat: if true, this piece must NOT start its owner's next turn adjacent to star
  heated: boolean;
};

export type StaticHazardType = "planet" | "star";
export type StaticHazard = {
  kind: StaticHazardType;
  pos: Square;
};

export type HazardDir = "E" | "W" | "N" | "S";

export type FlyingHazard = {
  id: string;
  pos: Square;
  dir: HazardDir;
  alive: boolean;
};

export type GameState = {
  rows: number;
  cols: number;

  sideToMove: Side;
  ply: number; // increments each player move (white move=1, black move=2, ...)

  pieces: Piece[];
  statics: StaticHazard[];
  flyers: FlyingHazard[];

  // Optional: deterministic randomness
  rngSeed: number;
};

export type Move = {
  from: Square;
  to: Square;
};
