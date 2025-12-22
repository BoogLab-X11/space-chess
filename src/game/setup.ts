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

    // --- Tuning knobs ---
  const NUM_PLANETS = 3;

  // Central hazard belts (board notation ranks)
  // Hazard belt is 6 deep: ranks 3..8 (inclusive)
  const hazardBeltRankMin = 4;
  const hazardBeltRankMax = 7;

  // Star belt is 4 deep: ranks 4..7 (inclusive)
  const starBeltRankMin = 5;
  const starBeltRankMax = 6;

  // Column confinement (internal columns: A=0 ... )
  // Example: cols=20 => 0..19. Constrain hazards to the centre.
  const hazardBeltColMin = 4;
  const hazardBeltColMax = 16;

  // Star can be even more central than planets if you like
  const starBeltColMin = 9;
  const starBeltColMax = 10;


  const occupied = new Set<string>();
  for (const p of pieces) occupied.add(sqKey(p.pos));

  const statics: StaticHazard[] = [];

   function placeOne(
    kind: "planet" | "star",
    rankMin: number,
    rankMax: number,
    colMin: number,
    colMax: number
  ) {
    // clamp cols to board
    const cMin = Math.max(0, colMin);
    const cMax = Math.min(cols - 1, colMax);

    for (let tries = 0; tries < 1000; tries++) {
      const rank = randInt(rng, rankMin, rankMax);
      const r = rFromRank(rank, rows);
      const c = randInt(rng, cMin, cMax);
      const key = `${r},${c}`;
      if (occupied.has(key)) continue;
      occupied.add(key);
      statics.push({ kind, pos: { r, c } });
      return;
    }
    throw new Error(`Failed to place ${kind}`);
  }


   // Planets
  for (let i = 0; i < NUM_PLANETS; i++) {
    placeOne("planet", hazardBeltRankMin, hazardBeltRankMax, hazardBeltColMin, hazardBeltColMax);
  }

  // Star
  placeOne("star", starBeltRankMin, starBeltRankMax, starBeltColMin, starBeltColMax);

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
