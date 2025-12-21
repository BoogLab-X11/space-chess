import type { GameState } from "./types";
import { isAdjacent8 } from "./geom";

export function starSquare(state: GameState) {
  return state.statics.find(h => h.kind === "star")?.pos;
}

/**
 * At the START of a side's turn:
 * If any of that side's pieces are marked heated and are still adjacent to star -> destroy them.
 * Then clear heated flags for that side (they've "resolved" this turn).
 */
export function resolveHeatAtTurnStart(state: GameState): void {
  const star = starSquare(state);
  if (!star) return;

  for (const p of state.pieces) {
    if (!p.alive) continue;
    if (p.side !== state.sideToMove) continue;
    if (!p.heated) continue;

    if (isAdjacent8(p.pos, star)) {
      p.alive = false;
    }
    // Either way, the "must move away" condition is now resolved for this turn start.
    p.heated = false;
  }
}

/**
 * After a player MOVE (before hazards tick), mark any of that player's pieces
 * that are adjacent to star as heated. This makes them have to move away next time.
 */
export function markHeatAfterMove(state: GameState, movedSide: "W" | "B"): void {
  const star = starSquare(state);
  if (!star) return;

  for (const p of state.pieces) {
    if (!p.alive) continue;
    if (p.side !== movedSide) continue;

    if (isAdjacent8(p.pos, star)) {
      p.heated = true;
    }
  }
}
