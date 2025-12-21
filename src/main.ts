import { createInitialState } from "./game/setup";
import { applyMove, mkMove } from "./game/applyMove";
import type { GameState, Square } from "./game/types";
import { pieceAt, staticAt, flyerAt } from "./game/indexes";

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

  const one = { r: from.r + dir, c: from.c };
  if (one.r >= 0 && one.r < ROWS && !pieceAt(state, one) && !staticAt(state, one)) {
    out.push(one);

    // Two-square launch boost
    const two = { r: from.r + 2 * dir, c: from.c };
    if (
      from.r === startRank &&
      !pieceAt(state, two) &&
      !staticAt(state, two)
    ) {
      out.push(two);
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
}

// --- Input state ---
let selected: Square | null = null;
let legal: Square[] = [];

canvas.addEventListener("click", (ev) => {
  const rect = canvas.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const y = ev.clientY - rect.top;

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

const win = winnerIfAny(state);
if (win) {
  gameOver = { winner: win };
}

});

// --- Render ---
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
  for (const hz of state.flyers) {
    const cx = x0 + (hz.pos.c + 0.5) * tileSize;
    const cy = y0 + (hz.pos.r + 0.5) * tileSize;
    ctx.fillStyle = "#a0aec0";
    ctx.beginPath();
    ctx.arc(cx, cy, tileSize * 0.18, 0, Math.PI * 2);
    ctx.fill();
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
