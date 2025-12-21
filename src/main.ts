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

function rookLegalDests(state: GameState, from: Square): Square[] {
  const out: Square[] = [];
  const dirs = [
    { dr: -1, dc: 0 },
    { dr: 1, dc: 0 },
    { dr: 0, dc: -1 },
    { dr: 0, dc: 1 },
  ];

  for (const d of dirs) {
    let r = from.r + d.dr;
    let c = from.c + d.dc;

    while (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
      const sq = { r, c };

      // static hazard: rook may move onto it (suicide), but cannot go past
      if (staticAt(state, sq)) {
        out.push(sq);
        break;
      }


      // static hazard: rook may move onto it (suicide), but cannot go past it
      if (staticAt(state, sq)) {
        out.push(sq);
        break;
      }

      // flying hazard: rook may move onto it (impact), but cannot go past it
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

// --- Input state ---
let selected: Square | null = null;
let legal: Square[] = [];

canvas.addEventListener("click", (ev) => {
  const rect = canvas.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const y = ev.clientY - rect.top;

  const sq = screenToSquare(x, y);
  if (!sq) return;

  if (!selected) {
    const p = pieceAt(state, sq);
    if (p && p.side === state.sideToMove) {
      selected = sq;
      legal = p.type === "R" ? rookLegalDests(state, sq) : [];
    }
    return;
  }

  // attempt move
  applyMove(state, mkMove(selected, sq));
  selected = null;
  legal = [];
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
  ctx.fillText(`Rooks obey rook rules; other pieces teleport (for now).`, 16, 48);
}

function loop() {
  draw(state);
  requestAnimationFrame(loop);
}
loop();
