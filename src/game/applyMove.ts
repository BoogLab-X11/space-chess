import type { GameState, Move, Square } from "./types";
import { inBounds } from "./geom";
import { pieceAt, staticAt, flyerAt } from "./indexes";
import { markHeatAfterMove, resolveHeatAtTurnStart } from "./starHeat";
import { hazardTick, maybeSpawnHazards } from "./hazards";

function other(side: "W" | "B"): "W" | "B" {
  return side === "W" ? "B" : "W";
}

function pathClearForSlide(state: GameState, from: Square, to: Square, dr: number, dc: number): boolean {
  let r = from.r + dr;
  let c = from.c + dc;

  // walk squares between from and to (exclusive)
  while (r !== to.r || c !== to.c) {
    const sq = { r, c };

    // Pieces block
    if (pieceAt(state, sq)) return false;

    // Static hazards block
    if (staticAt(state, sq)) return false;

    // Flying hazards also block sliding rays
    const hz = flyerAt(state, sq);
    if (hz && hz.alive) return false;

    r += dr;
    c += dc;
  }

  return true;
}

function isRookMoveLegal(state: GameState, from: Square, to: Square): boolean {
  if (from.r === to.r && from.c !== to.c) {
    const dc = to.c > from.c ? 1 : -1;
    return pathClearForSlide(state, from, to, 0, dc);
  }
  if (from.c === to.c && from.r !== to.r) {
    const dr = to.r > from.r ? 1 : -1;
    return pathClearForSlide(state, from, to, dr, 0);
  }
  return false;
}

function isKnightMoveLegal(from: Square, to: Square): boolean {
  const dr = Math.abs(to.r - from.r);
  const dc = Math.abs(to.c - from.c);
  return (dr === 2 && dc === 1) || (dr === 1 && dc === 2);
}

function isKingMoveLegal(from: Square, to: Square): boolean {
  const dr = Math.abs(to.r - from.r);
  const dc = Math.abs(to.c - from.c);
  // no castling (spacecraft), just one square any direction
  return (dr <= 1 && dc <= 1) && !(dr === 0 && dc === 0);
}


function isBishopMoveLegal(state: GameState, from: Square, to: Square): boolean {
  const dr = to.r - from.r;
  const dc = to.c - from.c;
  if (dr === 0 || dc === 0) return false;
  if (Math.abs(dr) !== Math.abs(dc)) return false;

  const stepR = dr > 0 ? 1 : -1;
  const stepC = dc > 0 ? 1 : -1;
  return pathClearForSlide(state, from, to, stepR, stepC);
}

function isPawnMoveLegal(state: GameState, from: Square, to: Square, side: "W" | "B"): boolean {
  const dir = side === "W" ? -1 : 1; // white moves "up" the board visually
  const startRank = side === "W" ? state.rows - 2 : 1; // rank 2 or 9 internally

  const dr = to.r - from.r;
  const dc = to.c - from.c;

  const destPiece = pieceAt(state, to);

    // Straight forward move
  if (dc === 0) {
    const hz = flyerAt(state, to);

    // One square forward
    if (dr === dir && !destPiece) {
      // normal move onto empty square
      if (!staticAt(state, to) && !(hz && hz.alive)) return true;

      // suicidal move into static or flying hazard
      if (staticAt(state, to)) return true;
      if (hz && hz.alive) return true;
    }

    // Two-square launch boost from starting rank
    if (from.r === startRank && dr === 2 * dir && !destPiece) {
      const mid = { r: from.r + dir, c: from.c };

      // mid-square must be clear of pieces and static hazards
      if (pieceAt(state, mid)) return false;
      if (staticAt(state, mid)) return false;

      // destination can be empty OR hazard (suicidal)
      const hz2 = flyerAt(state, to);
      if (!staticAt(state, to) && !(hz2 && hz2.alive)) return true;
      if (staticAt(state, to)) return true;
      if (hz2 && hz2.alive) return true;
    }
  }

  // Diagonal capture
    // Diagonal capture OR diagonal suicide into hazards
  if (Math.abs(dc) === 1 && dr === dir) {
    // capture
    if (destPiece && destPiece.side !== side) return true;

    // suicide into static hazard
    if (staticAt(state, to)) return true;

    // suicide into flying hazard
    const hz = flyerAt(state, to);
    if (hz && hz.alive) return true;
  }


  return false;
}


function isQueenMoveLegal(state: GameState, from: Square, to: Square): boolean {
  return isRookMoveLegal(state, from, to) || isBishopMoveLegal(state, from, to);
}


function postMoveHazardsAndTurnAdvance(state: GameState): void {
  // Hazards tick after each player move (with spawn)
  maybeSpawnHazards(state);
  hazardTick(state);

  // Next turn
  state.sideToMove = other(state.sideToMove);
  state.ply += 1;
}

/**
 * Minimal move applier:
 * - Only rooks have real legality; all other pieces still "teleport".
 * - Static hazards: landing on them suicides the mover.
 * - Flying hazards: landing on them destroys both immediately.
 * - After each move: hazards spawn+tick, then side changes.
 * - Star heat is enforced at the start of the mover's turn, and heat is marked after a move.
 */
export function applyMove(state: GameState, move: Move): void {
  // Start-of-turn: resolve burn for heated pieces of this side
  resolveHeatAtTurnStart(state);

  const mover = pieceAt(state, move.from);
  if (!mover || !mover.alive) return;
  if (mover.side !== state.sideToMove) return;

  if (!inBounds(move.to, state.rows, state.cols)) return;

  // Friendly piece on destination blocks
  const destPiece = pieceAt(state, move.to);
  if (destPiece && destPiece.side === mover.side) return;

  // Rook legality only (others are teleport)
  if (mover.type === "R") {
  if (!isRookMoveLegal(state, move.from, move.to)) return;
} else if (mover.type === "B") {
  if (!isBishopMoveLegal(state, move.from, move.to)) return;
} else if (mover.type === "Q") {
  if (!isQueenMoveLegal(state, move.from, move.to)) return;
} else if (mover.type === "P") {
  if (!isPawnMoveLegal(state, move.from, move.to, mover.side)) return;
} else if (mover.type === "N") {
  if (!isKnightMoveLegal(move.from, move.to)) return;
} else if (mover.type === "K") {
  if (!isKingMoveLegal(move.from, move.to)) return;
}




  // Landing on a flying hazard => impact destroys both; move consumed
  const destHz = flyerAt(state, move.to);
  if (destHz && destHz.alive) {
  // Treat as moving into the square, then exploding
  mover.pos = { ...move.to };
  mover.alive = false;

  destHz.alive = false;
  state.flyers = state.flyers.filter(h => h.alive);

  postMoveHazardsAndTurnAdvance(state);
  return;
}


  // Capture enemy on destination (if present)
  if (destPiece && destPiece.side !== mover.side) {
    destPiece.alive = false;
  }

  // Landing on static hazard => suicidal move (mover dies, doesn't occupy the square)
  if (staticAt(state, move.to)) {
  mover.pos = { ...move.to };
  mover.alive = false;
  postMoveHazardsAndTurnAdvance(state);
  return;
}


  // Normal move
  mover.pos = { ...move.to };

  // Mark heat for mover's side after move (any of their pieces adjacent become heated)
  markHeatAfterMove(state, state.sideToMove);

  postMoveHazardsAndTurnAdvance(state);
}

export function mkMove(from: Square, to: Square): Move {
  return { from, to };
}
