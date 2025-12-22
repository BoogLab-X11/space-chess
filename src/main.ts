import { createInitialState } from "./game/setup";
import { applyMove, mkMove } from "./game/applyMove";
import type { GameState, Square } from "./game/types";
import { pieceAt, staticAt, flyerAt } from "./game/indexes";

// --- Audio (retro explosion) ---
let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return audioCtx;
}


const FILES = "ABCDEFGHIJKLMNOPQRST";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app not found");

app.style.margin = "0";
app.style.width = "100vw";
app.style.height = "100vh";
app.style.overflow = "hidden";

const canvas = document.createElement("canvas");
canvas.style.width = "100%";
canvas.style.height = "100%";
canvas.style.display = "block";
app.appendChild(canvas);

const ctx = canvas.getContext("2d")!;
if (!ctx) throw new Error("2D context not available");

window.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "r") resetGame(42);
});

function resizeCanvasToDisplaySize() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resizeCanvasToDisplaySize);
resizeCanvasToDisplaySize();

// --- Game state ---
const ROWS = 10;
const COLS = 20;
let state: GameState = createInitialState(ROWS, COLS, 42);
const AI_THINK_MS = 500; // tweak this


// --- Board layout ---
const OUTER_MARGIN = 40;
const BORDER = 3;

function computeBoardLayout(viewW: number, viewH: number) {
  const usableW = Math.max(0, viewW - OUTER_MARGIN * 2);
  const usableH = Math.max(0, viewH - OUTER_MARGIN * 2);
  const tileSize = Math.floor(Math.min(usableW / COLS, usableH / ROWS));
  const boardW = tileSize * COLS;
  const boardH = tileSize * ROWS;
  const x0 = Math.floor((viewW - boardW) / 2);
  const y0 = Math.floor((viewH - boardH) / 2);
  return { x0, y0, tileSize, boardW, boardH };
}

function screenToSquare(x: number, y: number): Square | null {
  const rect = canvas.getBoundingClientRect();
  const viewW = rect.width;
  const viewH = rect.height;
  const { x0, y0, tileSize, boardW, boardH } = computeBoardLayout(viewW, viewH);

  if (x < x0 || y < y0 || x >= x0 + boardW || y >= y0 + boardH) return null;

  const c = Math.floor((x - x0) / tileSize);
  const r = Math.floor((y - y0) / tileSize);
  return { r, c };
}

function slideLegalDests(state: GameState, from: Square, dirs: Array<{ dr: number; dc: number }>): Square[] {
  const out: Square[] = [];

  for (const d of dirs) {
    let r = from.r + d.dr;
    let c = from.c + d.dc;

    while (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
      const sq = { r, c };

      // Static hazard: slider may move onto it (suicide), but cannot go past
      if (staticAt(state, sq)) {
        out.push(sq);
        break;
      }

      // Flying hazard: slider may move onto it (impact), but cannot go past
      const hz = flyerAt(state, sq);
      if (hz && hz.alive) {
        out.push(sq);
        break;
      }

      const p = pieceAt(state, sq);
      if (p) {
        if (p.side !== state.sideToMove) out.push(sq); // capture
        break;
      }

      out.push(sq);
      r += d.dr;
      c += d.dc;
    }
  }

  return out;
}

function pawnLegalDests(state: GameState, from: Square, side: "W" | "B"): Square[] {
  const out: Square[] = [];
  const dir = side === "W" ? -1 : 1;
  const startRank = side === "W" ? ROWS - 2 : 1;

  // Forward moves (including suicidal moves into hazards)
const one = { r: from.r + dir, c: from.c };
if (one.r >= 0 && one.r < ROWS) {
  const destPiece = pieceAt(state, one);
  const hz1 = flyerAt(state, one);

  // Pawns may move forward if no piece blocks the square
  if (!destPiece) {
    // Empty square OR hazard square are both legal destinations
    out.push(one);

    // Two-square launch boost from starting rank
    const two = { r: from.r + 2 * dir, c: from.c };
    if (
      from.r === startRank &&
      two.r >= 0 &&
      two.r < ROWS
    ) {
      const mid = { r: from.r + dir, c: from.c };

      // Mid-square must not contain a piece or static hazard
      if (
        !pieceAt(state, mid) &&
        !staticAt(state, mid)
      ) {
        // Destination must not have a piece (hazards OK)
        if (!pieceAt(state, two)) {
          out.push(two);
        }
      }
    }
  }
}


  // Diagonal captures
  for (const dc of [-1, 1]) {
    const diag = { r: from.r + dir, c: from.c + dc };
    if (diag.r < 0 || diag.r >= ROWS || diag.c < 0 || diag.c >= COLS) continue;

    const p = pieceAt(state, diag);
    if (p && p.side !== side) out.push(diag);
  }

  return out;
}

function knightLegalDests(state: GameState, from: Square): Square[] {
  const out: Square[] = [];
  const deltas = [
    { dr: -2, dc: -1 }, { dr: -2, dc: 1 },
    { dr: -1, dc: -2 }, { dr: -1, dc: 2 },
    { dr: 1, dc: -2 },  { dr: 1, dc: 2 },
    { dr: 2, dc: -1 },  { dr: 2, dc: 1 },
  ];

  for (const d of deltas) {
    const sq = { r: from.r + d.dr, c: from.c + d.dc };
    if (sq.r < 0 || sq.r >= ROWS || sq.c < 0 || sq.c >= COLS) continue;

    // Friendly piece blocks destination
    const p = pieceAt(state, sq);
    if (p && p.side === state.sideToMove) continue;

    // Otherwise it's selectable (empty, enemy capture, static hazard suicide, flying hazard impact)
    out.push(sq);
  }

  return out;
}

function kingLegalDests(state: GameState, from: Square): Square[] {
  const out: Square[] = [];

  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const sq = { r: from.r + dr, c: from.c + dc };
      if (sq.r < 0 || sq.r >= ROWS || sq.c < 0 || sq.c >= COLS) continue;

      const p = pieceAt(state, sq);
      if (p && p.side === state.sideToMove) continue;

      out.push(sq);
    }
  }

  return out;
}

function isKingAlive(state: GameState, side: "W" | "B"): boolean {
  return state.pieces.some(p => p.alive && p.side === side && p.type === "K");
}

function winnerIfAny(state: GameState): "W" | "B" | null {
  const wAlive = isKingAlive(state, "W");
  const bAlive = isKingAlive(state, "B");
  if (wAlive && bAlive) return null;
  if (wAlive && !bAlive) return "W";
  if (!wAlive && bAlive) return "B";
  // extremely rare: both dead same tick (e.g. hazards) – call it a draw later, but for now:
  return null;
}

let gameOver: { winner: "W" | "B" } | null = null;

function resetGame(seed = 42) {
  state = createInitialState(ROWS, COLS, seed);
  selected = null;
  legal = [];
  gameOver = null;

  lastBlackMoveTo = null;
  aiThinking = false;
  aiToken = 0;
}


// --- Input state ---
let selected: Square | null = null;
let legal: Square[] = [];
let lastBlackMoveTo: Square | null = null;
let aiThinking = false;
let aiToken = 0;

type Explosion = {
  sq: Square;        // board square where it happened
  t0: number;        // start time (ms)
  ttl: number;       // duration (ms)
};

const explosions: Explosion[] = [];


// --------------------
// Black AI (v1)
// --------------------

type CandidateMove = { from: Square; to: Square };

function cloneState(s: GameState): GameState {
  return {
    rows: s.rows,
    cols: s.cols,
    sideToMove: s.sideToMove,
    ply: s.ply,
    rngSeed: s.rngSeed,

    pieces: s.pieces.map(p => ({
      id: p.id,
      side: p.side,
      type: p.type,
      pos: { r: p.pos.r, c: p.pos.c },
      alive: p.alive,
      heated: p.heated,
    })),

    statics: s.statics.map(h => ({
      kind: h.kind,
      pos: { r: h.pos.r, c: h.pos.c },
    })),

    flyers: s.flyers.map(hz => ({
      id: hz.id,
      pos: { r: hz.pos.r, c: hz.pos.c },
      dir: hz.dir,
      alive: hz.alive,
    })),
  };
}

function isKingAliveLocal(state: GameState, side: "W" | "B"): boolean {
  return state.pieces.some(p => p.alive && p.side === side && p.type === "K");
}

function pieceValueLocal(t: string): number {
  switch (t) {
    case "P": return 1;
    case "N": return 3;
    case "B": return 3;
    case "R": return 5;
    case "Q": return 9;
    case "K": return 1000;
    default: return 0;
  }
}

// Score from BLACK’s perspective: positive is good for Black
function evaluateForBlack(state: GameState): number {
  const wAlive = isKingAliveLocal(state, "W");
  const bAlive = isKingAliveLocal(state, "B");

  if (!bAlive && wAlive) return -1_000_000;
  if (bAlive && !wAlive) return 1_000_000;
  if (!bAlive && !wAlive) return 0;

  let score = 0;
  for (const p of state.pieces) {
    if (!p.alive) continue;
    const v = pieceValueLocal(p.type);
    score += (p.side === "B") ? v : -v;
  }

  // tiny nudge: avoid staying heated
  for (const p of state.pieces) {
    if (!p.alive) continue;
    if (p.side === "B" && p.heated) score -= 0.25;
    if (p.side === "W" && p.heated) score += 0.25;
  }

  return score;
}

function legalMovesForBlack(state: GameState): CandidateMove[] {
  // IMPORTANT: this generator assumes it's Black to move
  // because your helper functions treat state.sideToMove as "friendly".
  if (state.sideToMove !== "B") return [];

  const moves: CandidateMove[] = [];

  for (const p of state.pieces) {
    if (!p.alive) continue;
    if (p.side !== "B") continue;

    const from = { r: p.pos.r, c: p.pos.c };
    let dests: Square[] = [];

    if (p.type === "R") {
      dests = slideLegalDests(state, from, [
        { dr: -1, dc: 0 }, { dr: 1, dc: 0 }, { dr: 0, dc: -1 }, { dr: 0, dc: 1 },
      ]);
    } else if (p.type === "B") {
      dests = slideLegalDests(state, from, [
        { dr: -1, dc: -1 }, { dr: -1, dc: 1 }, { dr: 1, dc: -1 }, { dr: 1, dc: 1 },
      ]);
    } else if (p.type === "Q") {
      dests = slideLegalDests(state, from, [
        { dr: -1, dc: 0 }, { dr: 1, dc: 0 }, { dr: 0, dc: -1 }, { dr: 0, dc: 1 },
        { dr: -1, dc: -1 }, { dr: -1, dc: 1 }, { dr: 1, dc: -1 }, { dr: 1, dc: 1 },
      ]);
    } else if (p.type === "P") {
      dests = pawnLegalDests(state, from, "B");
    } else if (p.type === "N") {
      dests = knightLegalDests(state, from);
    } else if (p.type === "K") {
      dests = kingLegalDests(state, from);
    }

    for (const to of dests) moves.push({ from, to });
  }

  return moves;
}

function chooseBlackMove(state: GameState): CandidateMove | null {
  if (state.sideToMove !== "B") return null;

  const candidates = legalMovesForBlack(state);
  if (candidates.length === 0) return null;

  let best: CandidateMove | null = null;
  let bestScore = -Infinity;

  for (const m of candidates) {
    const sim = cloneState(state);
    applyMove(sim, mkMove(m.from, m.to)); // includes hazards + star burn
    const score = evaluateForBlack(sim);
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }

  return best;
}

function runBlackAIIfNeeded() {
  if (gameOver) return;
  if (state.sideToMove !== "B") return;
  if (aiThinking) return;

  aiThinking = true;
  const myToken = ++aiToken;

  window.setTimeout(() => {
    // If something changed while "thinking" (reset, game over, not black's turn), abort.
    if (myToken !== aiToken) { aiThinking = false; return; }
    if (gameOver) { aiThinking = false; return; }
    if (state.sideToMove !== "B") { aiThinking = false; return; }

    const m = chooseBlackMove(state);
    if (!m) {
      aiThinking = false;
      return;
    }

    // Mark last black destination square for UI
    lastBlackMoveTo = { r: m.to.r, c: m.to.c };

    // clear any selection UI
    selected = null;
    legal = [];

    // Apply the AI move (hazards tick inside applyMove after the move)
    // (Your explosion-diff code should remain around this call, if you added it.)
    applyMove(state, mkMove(m.from, m.to));

    // Check win after Black's move
    const win = winnerIfAny(state);
    if (win) {
      gameOver = { winner: win };
    }

    aiThinking = false;
  }, AI_THINK_MS);
}


canvas.addEventListener("click", (ev) => {
  const rect = canvas.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const y = ev.clientY - rect.top;
  const aliveBefore = new Set(
  state.pieces.filter(p => p.alive).map(p => p.id)
);


  const sq = screenToSquare(x, y);
  if (gameOver) return;

  if (!sq) return;

  if (!selected) {
  const p = pieceAt(state, sq);
  if (!p) return;
  if (p.side !== state.sideToMove) return;

  selected = sq;

  if (p.type === "R") {
    legal = slideLegalDests(state, sq, [
      { dr: -1, dc: 0 },
      { dr: 1, dc: 0 },
      { dr: 0, dc: -1 },
      { dr: 0, dc: 1 },
    ]);
  } else if (p.type === "B") {
    legal = slideLegalDests(state, sq, [
      { dr: -1, dc: -1 },
      { dr: -1, dc: 1 },
      { dr: 1, dc: -1 },
      { dr: 1, dc: 1 },
    ]);
  } else if (p.type === "P") {
  legal = pawnLegalDests(state, sq, p.side);
} else if (p.type === "Q") {
    legal = slideLegalDests(state, sq, [
      { dr: -1, dc: 0 },
      { dr: 1, dc: 0 },
      { dr: 0, dc: -1 },
      { dr: 0, dc: 1 },
      { dr: -1, dc: -1 },
      { dr: -1, dc: 1 },
      { dr: 1, dc: -1 },
      { dr: 1, dc: 1 },
    ]);
  } else if (p.type === "N") {
  legal = knightLegalDests(state, sq);
} else if (p.type === "K") {
  legal = kingLegalDests(state, sq);

  } else {
    legal = [];
  }

  return;
}

  // attempt move
  applyMove(state, mkMove(selected, sq));
selected = null;
legal = [];

for (const p of state.pieces) {
  if (aliveBefore.has(p.id) && !p.alive) {
    spawnExplosion(p.pos);
  }
}


// Check win after White's move
  let win = winnerIfAny(state);
  if (win) {
    gameOver = { winner: win };
    return;
  }

  // Black AI responds (if it's now Black's turn)
  runBlackAIIfNeeded();

 

});

// --- Render ---

function playExplosionSound() {
  const ctx = getAudioCtx();
  const duration = 0.8; // seconds
  const sampleRate = ctx.sampleRate;
  const frameCount = Math.floor(sampleRate * duration);

  // Create noise buffer
  const buffer = ctx.createBuffer(1, frameCount, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frameCount; i++) {
    data[i] = Math.random() * 2 - 1; // white noise
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  // Low-pass filter with falling cutoff (key retro effect)
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(22000, ctx.currentTime);
  filter.frequency.exponentialRampToValueAtTime(
    12000,
    ctx.currentTime + duration
  );
//
  // Gain envelope (fast attack, decay)
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(
    0.8,
    ctx.currentTime + 0.02
  );
  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    ctx.currentTime + duration
  );

  // Wire it up
  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  source.start();
  source.stop(ctx.currentTime + duration);
}

function spawnExplosion(sq: Square, ttl = 1000) {
  explosions.push({ sq, t0: performance.now(), ttl });
  playExplosionSound();
}


function draw(state: GameState) {
  const rect = canvas.getBoundingClientRect();
  const viewW = rect.width;
  const viewH = rect.height;

  const { x0, y0, tileSize, boardW, boardH } = computeBoardLayout(viewW, viewH);

  // Background
  ctx.clearRect(0, 0, viewW, viewH);
  ctx.fillStyle = "#05070c";
  ctx.fillRect(0, 0, viewW, viewH);

  // Tiles
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const isDark = (r + c) % 2 === 1;
      ctx.fillStyle = isDark ? "#2a303d" : "#c9ced9";
      ctx.fillRect(x0 + c * tileSize, y0 + r * tileSize, tileSize, tileSize);
    }
  }

  // Highlight legal rook destinations
  if (legal.length > 0) {
    ctx.fillStyle = "rgba(72,187,120,0.25)";
    for (const sq of legal) {
      ctx.fillRect(x0 + sq.c * tileSize, y0 + sq.r * tileSize, tileSize, tileSize);
    }
  }

  // Border
  ctx.lineWidth = BORDER;
  ctx.strokeStyle = "#9aa3b2";
  ctx.strokeRect(x0, y0, boardW, boardH);

  // Key labels (left ranks + bottom files)
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = `${Math.floor(tileSize * 0.28)}px system-ui, sans-serif`;

  // ranks: 10..1 down the left
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let r = 0; r < ROWS; r++) {
    const rank = ROWS - r;
    const y = y0 + (r + 0.5) * tileSize;
    ctx.fillText(String(rank), x0 - 8, y);
  }

  // files: A..T along the bottom
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let c = 0; c < COLS; c++) {
    const file = FILES[c] ?? "?";
    const x = x0 + (c + 0.5) * tileSize;
    ctx.fillText(file, x, y0 + boardH + 6);
  }

  // Static hazards
  for (const h of state.statics) {
    const cx = x0 + (h.pos.c + 0.5) * tileSize;
    const cy = y0 + (h.pos.r + 0.5) * tileSize;
    const rad = tileSize * 0.38;

    if (h.kind === "planet") {
      ctx.fillStyle = "#2b6cb0";
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = "#f6e05e";
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "rgba(246,224,94,0.5)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, rad * 1.35, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Flying hazards
    // Flying hazards (directional: bright core + tail)
  for (const hz of state.flyers) {
    const cx = x0 + (hz.pos.c + 0.5) * tileSize;
    const cy = y0 + (hz.pos.r + 0.5) * tileSize;

    // Direction unit vector (movement direction)
    let dx = 0, dy = 0;
    switch (hz.dir) {
      case "E": dx = 1; dy = 0; break;
      case "W": dx = -1; dy = 0; break;
      case "N": dx = 0; dy = -1; break;
      case "S": dx = 0; dy = 1; break;
    }

    // Tail points opposite the direction of travel
    const tailLen = tileSize * 0.50;
    const tailWidth = tileSize * 0.25;

    const tx = cx - dx * tailLen;
    const ty = cy - dy * tailLen;

    // Draw tail as a tapered quad (sprite-friendly silhouette)
    ctx.save();
    ctx.globalAlpha = 0.85;

    // Tail color (warm-ish) - reads like a comet; you can change later
    ctx.fillStyle = "rgba(248, 15, 3, 0.55)";
    ctx.beginPath();

    // Perpendicular vector for width
    const px = -dy;
    const py = dx;

    // Tail near head (wider)
    const hx1 = cx + px * (tailWidth * 0.70);
    const hy1 = cy + py * (tailWidth * 0.70);
    const hx2 = cx - px * (tailWidth * 0.70);
    const hy2 = cy - py * (tailWidth * 0.70);

    // Tail end (narrower)
    const ex1 = tx + px * (tailWidth * 0.10);
    const ey1 = ty + py * (tailWidth * 0.10);
    const ex2 = tx - px * (tailWidth * 0.10);
    const ey2 = ty - py * (tailWidth * 0.10);

    ctx.moveTo(hx1, hy1);
    ctx.lineTo(hx2, hy2);
    ctx.lineTo(ex2, ey2);
    ctx.lineTo(ex1, ey1);
    ctx.closePath();
    ctx.fill();

    // Core (the "rock" / "head")
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#c77e47ff";
    ctx.beginPath();
    ctx.arc(cx, cy, tileSize * 0.17, 0, Math.PI * 2);
    ctx.fill();

    // Tiny highlight offset slightly forward (suggests motion direction)
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "rgba(203, 165, 116, 0.85)";
    ctx.beginPath();
    ctx.arc(cx + dx * tileSize * 0.07, cy + dy * tileSize * 0.07, tileSize * 0.05, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // Pieces
  for (const p of state.pieces) {
    if (!p.alive) continue;

    const cx = x0 + (p.pos.c + 0.5) * tileSize;
    const cy = y0 + (p.pos.r + 0.5) * tileSize;

    ctx.fillStyle = p.side === "W" ? "#f7fafc" : "#1a202c";
    ctx.beginPath();
    ctx.arc(cx, cy, tileSize * 0.32, 0, Math.PI * 2);
    ctx.fill();

    if (p.heated) {
      ctx.strokeStyle = "rgba(246,224,94,0.9)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, tileSize * 0.36, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = p.side === "W" ? "#1a202c" : "#f7fafc";
    ctx.font = `${Math.floor(tileSize * 0.32)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(p.type, cx, cy);
  }

    // Explosions (short-lived)
  const now = performance.now();
  for (let i = explosions.length - 1; i >= 0; i--) {
    const e = explosions[i];
    const age = now - e.t0;
    if (age >= e.ttl) {
      explosions.splice(i, 1);
      continue;
    }

    const t = age / e.ttl; // 0..1
    const cx = x0 + (e.sq.c + 0.5) * tileSize;
    const cy = y0 + (e.sq.r + 0.5) * tileSize;

    // Simple expanding ring + faint core (unobtrusive)
    const r1 = tileSize * (0.10 + 0.55 * t);
    const r2 = tileSize * (0.06 + 0.30 * t);

    ctx.save();

    // Fade over time
    ctx.globalAlpha = 0.85 * (1 - t);

    // Outer explosion ring (hot orange → red)
    ctx.strokeStyle = `rgba(255, ${Math.floor(160 * (1 - t))}, 0, 1)`;
    ctx.lineWidth = Math.max(1, tileSize * 0.07 * (1 - t));


    ctx.beginPath();
    ctx.arc(cx, cy, r1, 0, Math.PI * 2);
    ctx.stroke();

    // Inner core
    ctx.globalAlpha = 0.65 * (1 - t);
    ctx.fillStyle = "rgba(255, 60, 0, 1)";

    ctx.beginPath();
    ctx.arc(cx, cy, r2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }


  // Selected square highlight
  if (selected) {
    ctx.strokeStyle = "#48bb78";
    ctx.lineWidth = 4;
    ctx.strokeRect(
      x0 + selected.c * tileSize + 2,
      y0 + selected.r * tileSize + 2,
      tileSize - 4,
      tileSize - 4
    );
  }

  // Last black move indicator (destination square)
  if (lastBlackMoveTo) {
    ctx.strokeStyle = "#e53e3e";
    ctx.lineWidth = 4;
    ctx.strokeRect(
      x0 + lastBlackMoveTo.c * tileSize + 2,
      y0 + lastBlackMoveTo.r * tileSize + 2,
      tileSize - 4,
      tileSize - 4
    );
  }


  // HUD
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = "16px system-ui, sans-serif";
  ctx.fillText(`Side to move: ${state.sideToMove} | ply=${state.ply}`, 16, 26);
  // ctx.fillText(`Rooks obey rook rules; other pieces teleport (for now).`, 16, 48);

    if (gameOver) {
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(0, 0, viewW, viewH);

    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "48px system-ui, sans-serif";
    ctx.fillText(`${gameOver.winner === "W" ? "White" : "Black"} wins`, viewW / 2, viewH / 2 - 20);

    ctx.font = "18px system-ui, sans-serif";
    ctx.fillText(`Press R to restart`, viewW / 2, viewH / 2 + 30);
  }
}

function loop() {
  draw(state);
  requestAnimationFrame(loop);
}
loop();
