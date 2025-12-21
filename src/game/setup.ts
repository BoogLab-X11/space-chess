import type { GameState, Piece, StaticHazard, Square, Side, PieceType } from "./types";
import { mulberry32, randInt } from "./rng";

let pieceCounter = 0;
function pid() {
  pieceCounter += 1;
  return `p${pieceCounter}`;
}

function sqKey(s: Square) {
  return `${s.r},${s.c}`;
}

// Board-notation helpers:
// rank: 1..rows (1 is bottom), fileIndex: 0..cols-1 (A=0)
function rFromRank(rank: number, rows: number): number {
  return rows - rank; // rank 1 -> r=rows-1, rank rows -> r=0
}

export function createInitialState(rows: number, cols: number, seed = 123456): GameState {
  // Standard 8-file formation starting at file G (A=0 so G=6)
  const startFileIndex = 6; // G
  const files = Array.from({ length: 8 }, (_, i) => startFileIndex + i); // G..N

  const pieces: Piece[] = [];

  function add(side: Side, type: PieceType, fileIndex: number, rank: number) {
    pieces.push({
      id: pid(),
      side,
      type,
      pos: { r: rFromRank(rank, rows), c: fileIndex },
      alive: true,
      heated: false,
    });
  }

  // White: rank 1 (back rank) and rank 2 (pawns)
  // Layout from file G..N: R N B Q K B N R
  const back: PieceType[] = ["R", "N", "B", "Q", "K", "B", "N", "R"];
  for (let i = 0; i < 8; i++) add("W", back[i], files[i], 1);
  for (let i = 0; i < 8; i++) add("W", "P", files[i], 2);

  // Black: rank 10 (back rank) and rank 9 (pawns)
  for (let i = 0; i < 8; i++) add("B", back[i], files[i], 10);
  for (let i = 0; i < 8; i++) add("B", "P", files[i], 9);

  // --- Static hazards placement rules ---
  const rng = mulberry32(seed >>> 0);

  // Hazard belt is 6 deep, and must NOT touch starting zones.
  // With 10 ranks, that belt is ranks 3..8 inclusive (6 ranks).
  // Star must be confined to a 4-deep *central* belt to avoid adjacency risk to home areas:
  // that is ranks 4..7 inclusive (4 ranks).
  const hazardBeltRankMin = 3;
  const hazardBeltRankMax = 8;

  const starBeltRankMin = 4;
  const starBeltRankMax = 7;

  const minC = 0;
  const maxC = cols - 1;

  const occupied = new Set<string>();
  for (const p of pieces) occupied.add(sqKey(p.pos));

  const statics: StaticHazard[] = [];

  function placeOne(kind: "planet" | "star", rankMin: number, rankMax: number) {
    for (let tries = 0; tries < 1000; tries++) {
      const rank = randInt(rng, rankMin, rankMax);
      const r = rFromRank(rank, rows);
      const c = randInt(rng, minC, maxC);
      const key = `${r},${c}`;
      if (occupied.has(key)) continue;
      occupied.add(key);
      statics.push({ kind, pos: { r, c } });
      return;
    }
    throw new Error(`Failed to place ${kind}`);
  }

  // 3 planets anywhere in the 6-deep belt (ranks 3..8)
  placeOne("planet", hazardBeltRankMin, hazardBeltRankMax);
  placeOne("planet", hazardBeltRankMin, hazardBeltRankMax);
  placeOne("planet", hazardBeltRankMin, hazardBeltRankMax);

  // 1 star in the 4-deep central belt (ranks 4..7)
  placeOne("star", starBeltRankMin, starBeltRankMax);

  return {
    rows,
    cols,
    sideToMove: "W",
    ply: 0,
    pieces,
    statics,
    flyers: [],
    rngSeed: seed >>> 0,
  };
}
