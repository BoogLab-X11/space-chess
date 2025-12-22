import type { GameState, FlyingHazard, HazardDir, Square } from "./types";
import { inBounds } from "./geom";
import { pieceAt, staticAt } from "./indexes";
import { mulberry32, randInt } from "./rng";

function stepForDir(dir: HazardDir): { dr: number; dc: number } {
  switch (dir) {
    case "E": return { dr: 0, dc: 1 };
    case "W": return { dr: 0, dc: -1 };
    case "N": return { dr: -1, dc: 0 };
    case "S": return { dr: 1, dc: 0 };
  }
}

function nextSquare(pos: Square, dir: HazardDir): Square {
  const { dr, dc } = stepForDir(dir);
  return { r: pos.r + dr, c: pos.c + dc };
}

let hazardCounter = 0;
function newHazardId() {
  hazardCounter += 1;
  return `hz${hazardCounter}`;
}

/**
 * Spawn rules:
 * - Horizontal COMETS only:
 *   - spawn at column A or T (0 or cols-1)
 *   - spawn on a random belt row
 *   - dir is E (from A) or W (from T)
 *
 * - Vertical flyers (COMETS + ASTEROIDS):
 *   - spawn at row 1 or 10 (0 or rows-1)
 *   - spawn in edge bands: A–D and Q–T (tweakable via EDGE_BAND_DEPTH)
 *   - dir is S (from top) or N (from bottom)
 */

// Vertical flyer spawn band depth:
// 4 => A–D and (for 20 cols) Q–T
// 5 => A–E and (for 20 cols) P–T
const EDGE_BAND_DEPTH = 4;

function pickEdgeBandColumn(state: GameState, rng: () => number): number {
  const d = Math.max(1, Math.min(EDGE_BAND_DEPTH, Math.floor(state.cols / 2)));
  const off = randInt(rng, 0, d - 1);
  const fromLeft = rng() < 0.5;
  return fromLeft ? off : (state.cols - d + off);
}

export function maybeSpawnHazards(state: GameState): void {
  const rng = mulberry32(state.rngSeed);
  // advance seed for next time
  state.rngSeed = (state.rngSeed + 0x9e3779b9) >>> 0;

  // Central belt rows for 10-high with 6-deep belt: rows 2..7 inclusive
  const beltTop = 2;
  const beltBottom = 7;

  // Tune these:
  const spawnChanceCometHoriz = 0.35; // per flyer tick
  const spawnChanceCometVert = 0.20;

  const spawnChanceAsteroidVert = 0.12;

  // --------------------
  // HORIZONTAL COMETS (hazards) — ONLY A/T, belt rows only
  // --------------------
  if (rng() < spawnChanceCometHoriz) {
    const row = randInt(rng, beltTop, beltBottom);
    const fromLeft = rng() < 0.5;

    const hz: FlyingHazard = {
      id: newHazardId(),
      kind: "comet",
      pos: { r: row, c: fromLeft ? 0 : state.cols - 1 },
      dir: fromLeft ? "E" : "W",
      alive: true,
    };

    // If it spawns on a piece, destroy piece, comet disappears immediately (impact)
    const p = pieceAt(state, hz.pos);
    if (p) {
      p.alive = false;
      hz.alive = false;
    }

    // If it spawns on a static hazard, comet disappears
    const sh = staticAt(state, hz.pos);
    if (sh) hz.alive = false;

    if (hz.alive) state.flyers.push(hz);
  }

  // --------------------
  // VERTICAL COMETS (hazards) — edge bands A–D / Q–T, row 1/10 only
  // --------------------
  if (rng() < spawnChanceCometVert) {
    const col = pickEdgeBandColumn(state, rng);
    const fromTop = rng() < 0.5;

    const hz: FlyingHazard = {
      id: newHazardId(),
      kind: "comet",
      pos: { r: fromTop ? 0 : state.rows - 1, c: col },
      dir: fromTop ? "S" : "N",
      alive: true,
    };

    const p = pieceAt(state, hz.pos);
    if (p) {
      p.alive = false;
      hz.alive = false;
    }

    const sh = staticAt(state, hz.pos);
    if (sh) hz.alive = false;

    if (hz.alive) state.flyers.push(hz);
  }

  // --------------------
  // VERTICAL ASTEROIDS (collectibles) — edge bands A–D / Q–T, row 1/10 only
  // --------------------
  if (rng() < spawnChanceAsteroidVert) {
    const col = pickEdgeBandColumn(state, rng);
    const fromTop = rng() < 0.5;

    const hz: FlyingHazard = {
      id: newHazardId(),
      kind: "asteroid",
      pos: { r: fromTop ? 0 : state.rows - 1, c: col },
      dir: fromTop ? "S" : "N",
      alive: true,
    };

    // If it spawns on a static hazard, asteroid disappears
    const sh = staticAt(state, hz.pos);
    if (sh) hz.alive = false;

    // If it spawns on a piece, the piece collects it immediately
    const p = pieceAt(state, hz.pos);
    if (p) {
      hz.alive = false;
      state.manufacturing[p.side] += 1;
    }

    if (hz.alive) state.flyers.push(hz);
  }
}

/**
 * Advance all existing flyers by 1 square, resolving collisions.
 * - If flyer moves off board -> disappears
 * - If flyer moves onto a static hazard -> flyer disappears; static remains
 * - If flyer moves onto a piece:
 *    - comet => piece destroyed; comet disappears
 *    - asteroid => asteroid disappears; +1 manufacturing to that side
 */
export function hazardTick(state: GameState): void {
  for (const hz of state.flyers) {
    if (!hz.alive) continue;

    const nxt = nextSquare(hz.pos, hz.dir);

    // Off-board
    if (!inBounds(nxt, state.rows, state.cols)) {
      hz.alive = false;
      continue;
    }

    hz.pos = nxt;

    // Hit static hazard => flyer gone
    if (staticAt(state, hz.pos)) {
      hz.alive = false;
      continue;
    }

    // Hit piece => comet kills, asteroid collects
    const p = pieceAt(state, hz.pos);
    if (p) {
      if (hz.kind === "comet") {
        p.alive = false;
        hz.alive = false;
      } else {
        hz.alive = false;
        state.manufacturing[p.side] += 1;
      }
      continue;
    }
  }

  state.flyers = state.flyers.filter(h => h.alive);
}
