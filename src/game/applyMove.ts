import type { GameState, Move, Square } from "./types";
import { inBounds } from "./geom";
import { pieceAt, staticAt, flyerAt } from "./indexes";
import { markHeatAfterMove, resolveHeatAtTurnStart } from "./starHeat";
import { hazardTick, maybeSpawnHazards } from "./hazards";

function other(side: "W" | "B"): "W" | "B" {
  return side === "W" ? "B" : "W";
}

function isRookMoveLegal(state: GameState, from: Square, to: Square): boolean {
  const sameRow = from.r === to.r;
  const sameCol = from.c === to.c;
  if (!sameRow && !sameCol) return false;

  const dr = sameRow ? 0 : (to.r > from.r ? 1 : -1);
  const dc = sameCol ? 0 : (to.c > from.c ? 1 : -1);

  // Walk squares between from and to (exclusive)
  let r = from.r + dr;
  let c = from.c + dc;
  while (r !== to.r || c !== to.c) {
    const sq = { r, c };

    // Any piece blocks
    if (pieceAt(state, sq)) return false;

    // Static hazard blocks rook movement through it
    if (staticAt(state, sq)) return false;

        const hz = flyerAt(state, sq);
    if (hz && hz.alive) return false;

    r += dr;
    c += dc;
  }

  return true;
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
  }

  // Landing on a flying hazard => impact destroys both; move consumed
  const destHz = flyerAt(state, move.to);
  if (destHz && destHz.alive) {
    mover.alive = false;
    destHz.alive = false;
    state.flyers = state.flyers.filter(h => h.alive);

    // No heat marking needed for a dead mover, but hazards still tick and turn advances
    postMoveHazardsAndTurnAdvance(state);
    return;
  }

  // Capture enemy on destination (if present)
  if (destPiece && destPiece.side !== mover.side) {
    destPiece.alive = false;
  }

  // Landing on static hazard => suicidal move (mover dies, doesn't occupy the square)
  if (staticAt(state, move.to)) {
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
