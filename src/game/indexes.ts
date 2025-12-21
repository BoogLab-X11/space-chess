import type { GameState, Square, Piece, StaticHazard, FlyingHazard } from "./types";
import { sameSq } from "./geom";

export function pieceAt(state: GameState, sq: Square): Piece | undefined {
  return state.pieces.find(p => p.alive && sameSq(p.pos, sq));
}

export function staticAt(state: GameState, sq: Square): StaticHazard | undefined {
  return state.statics.find(h => sameSq(h.pos, sq));
}

export function flyerAt(state: GameState, sq: Square): FlyingHazard | undefined {
  return state.flyers.find(f => f.alive && sameSq(f.pos, sq));
}
