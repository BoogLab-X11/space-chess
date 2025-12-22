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
 * Spawn rule (starter):
 * - With some probability each hazard tick, spawn:
 *   - a horizontal hazard entering from left or right into one of the belt rows
 *   - a vertical hazard entering from top or bottom in one of the outer "edge columns"
 *
 * Adjust probabilities/lanes later.
 */
// How many columns from each edge hazards can spawn in.
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

  // How many columns from each edge flyers can spawn in.
  // 4 => A–D and (for 20 cols) Q–T
  // 5 => A–E and (for 20 cols) P–T
  const EDGE_BAND_DEPTH = 4;

  function pickEdgeBandColumn(): number {
    const d = Math.max(1, Math.min(EDGE_BAND_DEPTH, Math.floor(state.cols / 2)));
    const off = randInt(rng, 0, d - 1);
    const fromLeft = rng() < 0.5;
    return fromLeft ? off : (state.cols - d + off);
  }

  // Tune these:
  const spawnChanceCometHoriz = 0.35; // per flyer tick
  const spawnChanceCometVert = 0.20;

  const spawnChanceAsteroidHoriz = 0.18;
  const spawnChanceAsteroidVert = 0.12;

  // --------------------
  // COMETS (hazards)
  // --------------------
  if (rng() < spawnChanceCometHoriz) {
    const row = randInt(rng, beltTop, beltBottom);
    const fromLeft = rng() < 0.5;

    const hz: FlyingHazard = {
      id: newHazardId(),
      kind: "comet",
      pos: {
        r: row,
        c: fromLeft
          ? randInt(rng, 0, Math.max(0, Math.min(EDGE_BAND_DEPTH - 1, state.cols - 1)))
          : randInt(rng, Math.max(0, state.cols - EDGE_BAND_DEPTH), state.cols - 1),
      },
      dir: fromLeft ? "E" : "W",
      alive: true,
    };

    // If it spawns on a piece, destroy piece, hazard disappears immediately (impact)
    const p = pieceAt(state, hz.pos);
    if (p) {
      p.alive = false;
      hz.alive = false;
    }

    // If it spawns on a static hazard, hazard disappears
    const sh = staticAt(state, hz.pos);
    if (sh) hz.alive = false;

    if (hz.alive) state.flyers.push(hz);
  }

  if (rng() < spawnChanceCometVert) {
    const col = pickEdgeBandColumn();
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
  // ASTEROIDS (collectibles)
  // --------------------
  if (rng() < spawnChanceAsteroidHoriz) {
    const row = randInt(rng, beltTop, beltBottom);
    const fromLeft = rng() < 0.5;

    const hz: FlyingHazard = {
      id: newHazardId(),
      kind: "asteroid",
      pos: {
        r: row,
        c: pickEdgeBandColumn(),
      },
      dir: fromLeft ? "E" : "W",
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

  if (rng() < spawnChanceAsteroidVert) {
    const col = pickEdgeBandColumn();
    const fromTop = rng() < 0.5;

    const hz: FlyingHazard = {
      id: newHazardId(),
      kind: "asteroid",
      pos: { r: fromTop ? 0 : state.rows - 1, c: col },
      dir: fromTop ? "S" : "N",
      alive: true,
    };

    const sh = staticAt(state, hz.pos);
    if (sh) hz.alive = false;

    const p = pieceAt(state, hz.pos);
    if (p) {
      hz.alive = false;
      state.manufacturing[p.side] += 1;
    }

    if (hz.alive) state.flyers.push(hz);
  }
}


/**
 * Advance all existing hazards by 1 square, resolving collisions.
 * Rules:
 * - If hazard moves off board -> disappears
 * - If hazard moves onto a static hazard -> hazard disappears; static remains
 * - If hazard moves onto a piece -> piece destroyed; hazard disappears
 */
export function hazardTick(state: GameState): void {
  // Move each alive hazard once
  for (const hz of state.flyers) {
    if (!hz.alive) continue;

    const nxt = nextSquare(hz.pos, hz.dir);

    // Off-board
    if (!inBounds(nxt, state.rows, state.cols)) {
      hz.alive = false;
      continue;
    }

    hz.pos = nxt;

    // Hit static hazard => hazard gone
    if (staticAt(state, hz.pos)) {
      hz.alive = false;
      continue;
    }

        // Hit piece:
    // - comet => destroy piece and comet disappears
    // - asteroid => piece collects asteroid (+1 manufacturing), asteroid disappears
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

  // Cleanup dead hazards to keep array tidy (optional)
  state.flyers = state.flyers.filter(h => h.alive);
}
