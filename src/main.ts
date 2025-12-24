import { createInitialState } from "./game/setup";
import { applyMove, applyDeploy, mkMove } from "./game/applyMove";
import type { GameState, Square } from "./game/types";
import { pieceAt, staticAt, flyerAt } from "./game/indexes";
import { hazardTick, maybeSpawnHazards } from "./game/hazards";


// --- Audio (retro explosion) ---
let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return audioCtx;
}




const FILES = "ABCDEFGHIJKLMNOPQRST";

// --- Piece sprites (pixel art) ---
const PIECE_W = 16;
const PIECE_H = 32;

const pieceSprites: Record<string, HTMLImageElement> = {};

function loadPieceSprites() {
  const sides = ["W", "B"];
  const types = ["King", "Queen", "Rook", "Bishop", "Knight", "Pawn"];

  for (const s of sides) {
    for (const t of types) {
      const key = `${s}_${t}`;
      const img = new Image();
      img.src = `/pieces/${key}.png`;
      pieceSprites[key] = img;
    }
  }
}

loadPieceSprites();


const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app not found");

// Kill browser scrollbars / default margins so the canvas always fits the viewport
document.documentElement.style.margin = "0";
document.documentElement.style.padding = "0";
document.documentElement.style.overflow = "hidden";

document.body.style.margin = "0";
document.body.style.padding = "0";
document.body.style.overflow = "hidden";


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
ctx.imageSmoothingEnabled = false;

window.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "r") resetGame();
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
let state: GameState = createInitialState(ROWS, COLS, Date.now());
const AI_THINK_MS = 1500; // tweak this

// AI difficulty toggle (change manually for now)
const AI_DIFFICULTY: "easy" | "medium" | "hard" = "hard";
const AI_EASY_TOP_N = 8;     // easy picks randomly among top N
const AI_HARD_TOP_N = 20;    // hard search caps candidate actions




// --- Manufacturing / Deploy UI (v0) ---
let deployOpen = false;

// Standard chess manufacturing costs
const DEPLOY_COSTS: Record<"P" | "N" | "B" | "R" | "Q", number> = {
  P: 1,
  N: 3,
  B: 3,
  R: 5,
  Q: 9,
};

// Only 1 ship can be deployed per deploy action.
// The GUI selects exactly one type at a time:
let selectedDeployType: "P" | "N" | "B" | "R" | "Q" = "P";


// Helper: home row for deployment (rank 1 for White, rank 10 for Black)
function deployHomeRowFor(side: "W" | "B"): number {
  return side === "W" ? ROWS - 1 : 0;
}

function canDeployNow(s: GameState): boolean {
  if (gameOver) return false;

  const side = s.sideToMove;

  // White-only deploy for now (matching your current rules)
  if (side !== "W") return false;

  const cost = DEPLOY_COSTS[selectedDeployType];
  return s.manufacturing.W >= cost;
}


// UI rects (computed from current viewport)
type Rect = { x: number; y: number; w: number; h: number };

function pointInRect(px: number, py: number, r: Rect): boolean {
  return px >= r.x && py >= r.y && px < r.x + r.w && py < r.y + r.h;
}

function getUiRects(viewW: number, viewH: number) {
  const { x0, y0, boardW, boardH } = computeBoardLayout(viewW, viewH);

  // Factories sit to the right of the board
  const pad = 13;
  const size = 56;

  const fx = x0 + boardW + pad;

  // Black at top-right of the board area
  const factoryB: Rect = { x: fx, y: y0, w: size, h: size };

  // White at bottom-right of the board area
  const factoryW: Rect = { x: fx, y: y0 + boardH - size, w: size, h: size };

  // Deploy panel (centered-ish)
  const panelW = 320;
  const panelH = 320;
  const panel: Rect = {
    x: Math.floor((viewW - panelW) / 2),
    y: Math.floor((viewH - panelH) / 2),
    w: panelW,
    h: panelH,
  };

  return { factoryB, factoryW, panel };
}

type DeployChoice = {
  type: "P" | "N" | "B" | "R" | "Q";
  cost: number;
  rect: Rect;
};

function getDeployChoices(panel: Rect): DeployChoice[] {
  // Layout inside panel
  const left = panel.x + 16;
  const top = panel.y + 92; // below title/cost text area
  const rowH = 30;
  const rowW = panel.w - 32;

  const order: Array<"P" | "N" | "B" | "R" | "Q"> = ["P", "N", "B", "R", "Q"];

  return order.map((t, i) => ({
    type: t,
    cost: DEPLOY_COSTS[t],
    rect: { x: left, y: top + i * rowH, w: rowW, h: rowH - 4 },
  }));
}

function shipLabel(t: "P" | "N" | "B" | "R" | "Q"): string {
  switch (t) {
    case "P": return "Pawn";
    case "N": return "Knight";
    case "B": return "Bishop";
    case "R": return "Rook";
    case "Q": return "Queen";
  }
}



// --- Board layout ---
// --- Board layout ---
const OUTER_MARGIN = 40;
const BORDER = 3;

// Reserve space on the right for factories/panel UI so it never goes off-screen.
const UI_GUTTER_RIGHT = 30; // tweak if you change factory size/padding

function computeBoardLayout(viewW: number, viewH: number) {
  const usableW = Math.max(0, viewW - OUTER_MARGIN * 2 - UI_GUTTER_RIGHT);
  const usableH = Math.max(0, viewH - OUTER_MARGIN * 2);

  const tileSize = Math.floor(Math.min(usableW / COLS, usableH / ROWS));
  const boardW = tileSize * COLS;
  const boardH = tileSize * ROWS;

  // Center the board within the remaining usable area (leaving gutter on the right)
  const contentW = boardW + UI_GUTTER_RIGHT;
  const x0 = Math.floor((viewW - contentW) / 2);
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

function runHazardPhase(state: GameState) {
  // This mirrors what normally happens after Black acts
  hazardTick(state);
  maybeSpawnHazards(state);
}


function nextSquareForDir(pos: Square, dir: "N" | "S" | "E" | "W"): Square {
  switch (dir) {
    case "E": return { r: pos.r, c: pos.c + 1 };
    case "W": return { r: pos.r, c: pos.c - 1 };
    case "N": return { r: pos.r - 1, c: pos.c };
    case "S": return { r: pos.r + 1, c: pos.c };
  }
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
 // const hz1 = flyerAt(state, one);

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

function hazardNextSquare(pos: Square, dir: "N" | "S" | "E" | "W"): Square {
  switch (dir) {
    case "N": return { r: pos.r - 1, c: pos.c };
    case "S": return { r: pos.r + 1, c: pos.c };
    case "E": return { r: pos.r, c: pos.c + 1 };
    case "W": return { r: pos.r, c: pos.c - 1 };
  }
}

function willAnyCometHitSquareNextTick(state: GameState, sq: Square): boolean {
  for (const hz of state.flyers) {
    if (!hz.alive) continue;
    if (hz.kind !== "comet") continue; // only comets are lethal

    const nxt = hazardNextSquare(hz.pos, hz.dir);
    if (nxt.r === sq.r && nxt.c === sq.c) return true;
  }
  return false;
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
let lastBlackMovedPieceId: string | null = null;

function resetGame(seed = Date.now()) {
  state = createInitialState(ROWS, COLS, seed);
  selected = null;
  legal = [];
  gameOver = null;

    lastBlackMoveFrom = null;
  lastBlackMoveTo = null;
  hazardTrails.length = 0;
  

  lastBlackMoveTo = null;
  aiThinking = false;
  aiToken = 0;
}



// --- Input state ---
let selected: Square | null = null;
let legal: Square[] = [];

// Last Black move highlights
let lastBlackMoveFrom: Square | null = null;
let lastBlackMoveTo: Square | null = null;
let lastBlackAction: CandidateAction | null = null;


type HazardTrail = {
  from: Square;
  to: Square;
  kind: "comet" | "asteroid";
  t0: number;
  ttl: number;
};


const hazardTrails: HazardTrail[] = [];

let aiThinking = false;
let aiToken = 0;


type Explosion = {
  sq: Square;        // board square where it happened
  t0: number;        // start time (ms)
  ttl: number;       // duration (ms)
};

const explosions: Explosion[] = [];


// --------------------
// Black AI (v2: deploy + manufacturing-aware)
// --------------------

type CandidateMove = { from: Square; to: Square };
type CandidateAction =
  | { kind: "move"; from: Square; to: Square }
  | { kind: "deploy"; to: Square; type: "P" | "N" | "B" | "R" | "Q"; cost: number };

  
function willHazardHitSquare(state: GameState, sq: Square): boolean {
  for (const hz of state.flyers) {
    if (!hz.alive) continue;

    let dr = 0, dc = 0;
    if (hz.dir === "N") dr = -1;
    if (hz.dir === "S") dr = 1;
    if (hz.dir === "E") dc = 1;
    if (hz.dir === "W") dc = -1;

    const next = { r: hz.pos.r + dr, c: hz.pos.c + dc };
    if (next.r === sq.r && next.c === sq.c) return true;
  }
  return false;
}


function isExactReverse(prev: CandidateAction, cur: CandidateAction): boolean {
  if (prev.kind !== "move" || cur.kind !== "move") return false;
  return prev.from.r === cur.to.r && prev.from.c === cur.to.c &&
         prev.to.r === cur.from.r && prev.to.c === cur.from.c;
}

function cloneState(s: GameState): GameState {
  return {
    rows: s.rows,
    cols: s.cols,
    sideToMove: s.sideToMove,
    ply: s.ply,
    rngSeed: s.rngSeed,
    manufacturing: { W: s.manufacturing.W, B: s.manufacturing.B },

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
      kind: hz.kind,
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

  // Material
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

  // Manufacturing advantage matters a bit (small weight)
  score += 0.30 * (state.manufacturing.B - state.manufacturing.W);

  // Penalize Black pieces standing in imminent hazard paths
for (const p of state.pieces) {
  if (!p.alive) continue;
  if (p.side !== "B") continue;

  if (willHazardHitSquare(state, p.pos)) {
    score -= 2.5; // strong "get out of the way" signal
  }
}

  // Avoid standing in the path of a comet that will hit next hazard tick
  for (const p of state.pieces) {
    if (!p.alive) continue;

    // If a BLACK piece is about to be hit, that's bad for Black
    if (p.side === "B" && willAnyCometHitSquareNextTick(state, p.pos)) {
      score -= 3.0;
    }

    // If a WHITE piece is about to be hit, that's good for Black (tiny bonus)
    if (p.side === "W" && willAnyCometHitSquareNextTick(state, p.pos)) {
      score += 0.8;
    }
  }

  // --- Positional incentives ---

  // Mobility: prefer positions where Black has more options than White
  const mobB = countLegalMovesForSide(state, "B");
  const mobW = countLegalMovesForSide(state, "W");
  score += 0.03 * (mobB - mobW); // tweak 0.02–0.06

  // Light "development" nudge: encourage Black pieces (not pawns/king) off back rank
  // Internal row 0 is Black's back rank (rank 10).
  for (const p of state.pieces) {
    if (!p.alive) continue;

    if (p.side === "B" && (p.type === "N" || p.type === "B" || p.type === "R" || p.type === "Q")) {
      if (p.pos.r === 0) score -= 0.08;
    }

    // (optional) tiny inverse for White development, helps Black avoid letting White develop freely
    if (p.side === "W" && (p.type === "N" || p.type === "B" || p.type === "R" || p.type === "Q")) {
      if (p.pos.r === state.rows - 1) score += 0.04;
    }
  }

  return score;
}

function countLegalMovesForSide(state: GameState, side: "W" | "B"): number {
  const saved = state.sideToMove;
  state.sideToMove = side;

  let count = 0;

  for (const p of state.pieces) {
    if (!p.alive) continue;
    if (p.side !== side) continue;

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
      dests = pawnLegalDests(state, from, side);
    } else if (p.type === "N") {
      dests = knightLegalDests(state, from);
    } else if (p.type === "K") {
      dests = kingLegalDests(state, from);
    }

    count += dests.length;
  }

  state.sideToMove = saved;
  return count;
}


function legalMovesForBlack(state: GameState): CandidateMove[] {
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

function deploySquaresForBlack(state: GameState): Square[] {
  // Black home rank = rank 10 => internal row 0
  const r = 0;
  const out: Square[] = [];
  for (let c = 0; c < COLS; c++) {
    const sq = { r, c };
    if (pieceAt(state, sq)) continue;
    if (staticAt(state, sq)) continue;
    const hz = flyerAt(state, sq);
    if (hz && hz.alive) continue;
    out.push(sq);
  }
  return out;
}

function pickDeployTypesFor(mp: number): Array<"Q" | "R" | "N" | "B" | "P"> {
  // Prefer strongest affordable first
  const order: Array<"Q" | "R" | "N" | "B" | "P"> = ["Q", "R", "N", "B", "P"];
  return order.filter(t => mp >= DEPLOY_COSTS[t]);
}

function preferredDeploySquares(state: GameState, squares: Square[]): Square[] {
  // Prefer near Black's starting file "G" (A=0 => G=6)
  const g = 6;

  // Also gently prefer towards board center (COLS/2)
  const mid = (COLS - 1) / 2;

  return [...squares].sort((a, b) => {
    const da = Math.abs(a.c - g) + 0.25 * Math.abs(a.c - mid);
    const db = Math.abs(b.c - g) + 0.25 * Math.abs(b.c - mid);
    return da - db;
  });
}

function legalActionsForBlack(state: GameState): CandidateAction[] {
  if (state.sideToMove !== "B") return [];

  const actions: CandidateAction[] = [];

  // Normal moves
  for (const m of legalMovesForBlack(state)) {
    actions.push({ kind: "move", from: m.from, to: m.to });
  }

  // Deploy (if affordable)
  const mp = state.manufacturing.B;
  const types = pickDeployTypesFor(mp);
  if (types.length > 0) {
    const squares = preferredDeploySquares(state, deploySquaresForBlack(state));
    // Keep this bounded so we don't simulate too many.
    // We'll consider up to 8 best squares per type.
    const bestSquares = squares.slice(0, 8);

    for (const t of types) {
      const cost = DEPLOY_COSTS[t];
      for (const sq of bestSquares) {
        actions.push({ kind: "deploy", to: sq, type: t, cost });
      }
    }
  }

  return actions;
}

function chooseBlackAction(state: GameState): CandidateAction | null {
  if (state.sideToMove !== "B") return null;

  const candidates = legalActionsForBlack(state);
  if (candidates.length === 0) return null;

  // Helper: simulate one action on a clone and return eval score
  function scoreAfterBlackAction(a: CandidateAction): number {
    const sim = cloneState(state);

    if (a.kind === "move") {
      applyMove(sim, mkMove(a.from, a.to), "tickOnly"); // fair: no spawn peeking
    } else {
      applyDeploy(sim, a.to, a.type, a.cost, "tickOnly"); // fair: no spawn peeking
    }

    return evaluateForBlack(sim);
  }

  // EASY / MEDIUM: 1-ply scoring of all candidates
  if (AI_DIFFICULTY === "easy" || AI_DIFFICULTY === "medium") {
  const scored = candidates.map(a => {
  let s = scoreAfterBlackAction(a);

  // Discourage moving the same piece two Black turns in a row
  if (a.kind === "move" && lastBlackMovedPieceId) {
    const mover = pieceAt(state, a.from);
    if (mover && mover.id === lastBlackMovedPieceId) {
      s -= 0.35; // tweak 0.2–0.6
    }
  }

  return { a, s };
});
scored.sort((x, y) => y.s - x.s);


    if (AI_DIFFICULTY === "medium") {
      return scored[0]!.a;
    }

    // EASY: pick randomly among top N (less consistent, more human)
    const n = Math.max(1, Math.min(AI_EASY_TOP_N, scored.length));
    const pick = Math.floor(Math.random() * n);
    return scored[pick]!.a;
  }

  // HARD: 2-ply (Black -> best White reply), with candidate caps
  // We do:
  //   For each Black action in top N (by quick 1-ply score),
  //   simulate it, then let White choose best reply (also capped),
  //   then evaluate resulting state for Black.
  const scoredBlack = candidates.map(a => {
  let s = scoreAfterBlackAction(a);

  // discourage immediate back-and-forth
  if (lastBlackAction && isExactReverse(lastBlackAction, a)) {
    s -= 0.35;
  }

  return { a, s };
});
scoredBlack.sort((x, y) => y.s - x.s);


  const blackN = Math.max(1, Math.min(AI_HARD_TOP_N, scoredBlack.length));
  const blackPool = scoredBlack.slice(0, blackN);

  let bestA: CandidateAction | null = null;
  let bestS = -Infinity;

  for (const item of blackPool) {
    // Sim after Black
    const sim1 = cloneState(state);
    if (item.a.kind === "move") {
      applyMove(sim1, mkMove(item.a.from, item.a.to), "tickOnly");
    } else {
      applyDeploy(sim1, item.a.to, item.a.type, item.a.cost, "tickOnly");
    }

    // Now it's White to move in sim1. Pick White's best reply (1-ply), capped.
    const whiteMoves: CandidateMove[] = [];
    if (sim1.sideToMove === "W") {
      for (const p of sim1.pieces) {
        if (!p.alive || p.side !== "W") continue;
        const from = { r: p.pos.r, c: p.pos.c };
        let dests: Square[] = [];

        if (p.type === "R") {
          dests = slideLegalDests(sim1, from, [
            { dr: -1, dc: 0 }, { dr: 1, dc: 0 }, { dr: 0, dc: -1 }, { dr: 0, dc: 1 },
          ]);
        } else if (p.type === "B") {
          dests = slideLegalDests(sim1, from, [
            { dr: -1, dc: -1 }, { dr: -1, dc: 1 }, { dr: 1, dc: -1 }, { dr: 1, dc: 1 },
          ]);
        } else if (p.type === "Q") {
          dests = slideLegalDests(sim1, from, [
            { dr: -1, dc: 0 }, { dr: 1, dc: 0 }, { dr: 0, dc: -1 }, { dr: 0, dc: 1 },
            { dr: -1, dc: -1 }, { dr: -1, dc: 1 }, { dr: 1, dc: -1 }, { dr: 1, dc: 1 },
          ]);
        } else if (p.type === "P") {
          dests = pawnLegalDests(sim1, from, "W");
        } else if (p.type === "N") {
          dests = knightLegalDests(sim1, from);
        } else if (p.type === "K") {
          dests = kingLegalDests(sim1, from);
        }

        for (const to of dests) whiteMoves.push({ from, to });
      }
    }

    // If White has no moves, just evaluate sim1
    if (whiteMoves.length === 0) {
      const s = evaluateForBlack(sim1);
      if (s > bestS) { bestS = s; bestA = item.a; }
      continue;
    }

    // Score White replies: White tries to MINIMIZE Black's eval.
    // Cap to top N by "damage" (i.e., lowest black eval).
    const scoredWhite = whiteMoves.map(m => {
      const sim2 = cloneState(sim1);
      applyMove(sim2, mkMove(m.from, m.to), "tickOnly");
      return { m, s: evaluateForBlack(sim2) };
    });

    scoredWhite.sort((x, y) => x.s - y.s); // smallest evalForBlack = best for White
    const whiteN = Math.max(1, Math.min(AI_HARD_TOP_N, scoredWhite.length));
    const whiteBest = scoredWhite[0]!.s;

    // Black assumes White plays best reply
    if (whiteBest > bestS) {
      bestS = whiteBest;
      bestA = item.a;
    }
  }

  return bestA;
}




function runBlackAIIfNeeded() {
  if (gameOver) return;
  if (state.sideToMove !== "B") return;
  if (aiThinking) return;

  aiThinking = true;
  const myToken = ++aiToken;

  window.setTimeout(() => {
    if (myToken !== aiToken) { aiThinking = false; return; }
    if (gameOver) { aiThinking = false; return; }
    if (state.sideToMove !== "B") { aiThinking = false; return; }

    const a = chooseBlackAction(state);
    if (!a) { aiThinking = false; return; }

    if (a.kind === "move") {
  const mover = pieceAt(state, a.from);
  lastBlackMovedPieceId = mover ? mover.id : null;
} else {
  lastBlackMovedPieceId = null; // deploy shouldn't “lock” repetition
}


    // Snapshot A: alive pieces BEFORE Black action
    const aliveBeforeAction = new Set(
      state.pieces.filter(p => p.alive).map(p => p.id)
    );

    // Flyer snapshot for trails (if you're using it)
    const flyersBefore = state.flyers.map(hz => ({
      id: hz.id,
      kind: hz.kind,
      pos: { r: hz.pos.r, c: hz.pos.c },
      dir: hz.dir,
      alive: hz.alive,
    }));

    // Apply Black action WITHOUT hazard phase (so we can delay hazards)
    if (a.kind === "move") {
      lastBlackMoveFrom = { r: a.from.r, c: a.from.c };
      lastBlackMoveTo = { r: a.to.r, c: a.to.c };
      applyMove(state, mkMove(a.from, a.to), "none");
    } else {
      lastBlackMoveFrom = { r: a.to.r, c: a.to.c };
      lastBlackMoveTo = { r: a.to.r, c: a.to.c };
      applyDeploy(state, a.to, a.type, a.cost, "none");
    }

    // Explosions: deaths caused immediately by Black action
    for (const p of state.pieces) {
      if (aliveBeforeAction.has(p.id) && !p.alive) {
        spawnExplosion(p.pos);
      }
    }

    // Win check after Black action (before hazard phase)
    const winAfterAction = winnerIfAny(state);
    if (winAfterAction) {
      gameOver = { winner: winAfterAction };
      aiThinking = false;
      return;
    }

    // Snapshot B: alive pieces AFTER Black action, BEFORE hazards
    const aliveBeforeHazards = new Set(
      state.pieces.filter(p => p.alive).map(p => p.id)
    );

    // Hazard phase runs later so you can see the position after Black acts
    window.setTimeout(() => {
      if (gameOver) return;

      runHazardPhase(state);

      // Trails (optional): compare flyersBefore to current flyers
      const afterById = new Map(state.flyers.map(hz => [hz.id, { r: hz.pos.r, c: hz.pos.c }]));
      const nowT = performance.now();

      for (const fb of flyersBefore) {
        if (!fb.alive) continue;

        const afterPos = afterById.get(fb.id);
        if (afterPos) {
          if (afterPos.r !== fb.pos.r || afterPos.c !== fb.pos.c) {
            hazardTrails.push({
              from: { ...fb.pos },
              to: { ...afterPos },
              kind: fb.kind,
              t0: nowT,
              ttl: 900,
            });
          }
        } else {
          const to = nextSquareForDir(fb.pos, fb.dir);
          hazardTrails.push({
            from: { ...fb.pos },
            to,
            kind: fb.kind,
            t0: nowT,
            ttl: 900,
          });
        }
      }

      // Explosions: deaths caused by hazard phase only
      for (const p of state.pieces) {
        if (aliveBeforeHazards.has(p.id) && !p.alive) {
          spawnExplosion(p.pos);
        }
      }

      // Win check after hazard phase (hazards can kill kings)
      const winAfterHazards = winnerIfAny(state);
      if (winAfterHazards) gameOver = { winner: winAfterHazards };

    }, BLACK_HAZARD_DELAY_MS);

    aiThinking = false;
  }, AI_THINK_MS);
}




// Pause between Black move and hazard phase (for debugging / clarity)
const BLACK_HAZARD_DELAY_MS = 700; // try 500–1000


canvas.addEventListener("click", (ev) => {
  const rect = canvas.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const y = ev.clientY - rect.top;

  // UI hit-testing uses viewport units
  const viewW = rect.width;
  const viewH = rect.height;
    const { factoryB, factoryW, panel } = getUiRects(viewW, viewH);

  // If game over, ignore input
  if (gameOver) return;

  // Factory click opens deploy UI
  // (White-only deploy still enforced elsewhere; black factory just does nothing for now)
  if (pointInRect(x, y, factoryW) || pointInRect(x, y, factoryB)) {
    if (state.sideToMove === "W") {
      deployOpen = !deployOpen;
      selected = null;
      legal = [];
    }
    return;
  }


  // If deploy panel is open, clicks behave differently
   if (deployOpen) {
    // Clicking inside the panel: select which ship to deploy (only one at a time)
    if (pointInRect(x, y, panel)) {
      // White-only deploy UI for now
      if (state.sideToMove !== "W") return;

      const mp = state.manufacturing.W;
      const choices = getDeployChoices(panel);

      for (const ch of choices) {
        if (!pointInRect(x, y, ch.rect)) continue;

        // Only allow selecting choices you can afford
        if (mp >= ch.cost) {
          selectedDeployType = ch.type;
        }
        return;
      }

      // Clicked inside panel but not on a row: do nothing
      return;
    }


    // Clicking outside the panel: treat it as "attempt deploy on clicked square",
    // otherwise close the panel.
    const sq = screenToSquare(x, y);
    if (!sq) {
      deployOpen = false;
      return;
    }

    // Only White deploys for now
    if (state.sideToMove !== "W") {
      deployOpen = false;
      return;
    }

    // Must be on White home rank (rank 1 => internal row ROWS-1)
    const homeRow = deployHomeRowFor("W");
    if (sq.r !== homeRow) {
      deployOpen = false;
      return;
    }

    // Snapshot for explosion detection
    const aliveBefore = new Set(
      state.pieces.filter(p => p.alive).map(p => p.id)
    );

      const chosenType = selectedDeployType;
    const chosenCost = DEPLOY_COSTS[chosenType];

    // Attempt deploy (consumes turn if it succeeds)
    applyDeploy(state, sq, chosenType, chosenCost);


    // If turn advanced, deployment succeeded. (applyDeploy always advances on success.)
    // We'll detect success by checking if sideToMove flipped away from W.
    const deployed = (state.sideToMove !== "W");

    if (deployed) {
      // Clear any selection UI
      selected = null;
      legal = [];
      deployOpen = false;

     

      // Win check (deploy can cause star-burn deaths)
      const win = winnerIfAny(state);
      if (win) {
        gameOver = { winner: win };
        return;
      }

      // If it's now Black's turn, let AI respond
      runBlackAIIfNeeded();
      return;
    }

    // Deploy failed (invalid target, not enough points, occupied, hazard, etc.)
    // Close panel for simplicity.
    deployOpen = false;
    return;


  }


  const aliveBefore = new Set(
    state.pieces.filter(p => p.alive).map(p => p.id)
  );

  const sq = screenToSquare(x, y);
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
// Snapshot: alive pieces BEFORE White move
const aliveBeforeAction = new Set(
  state.pieces.filter(p => p.alive).map(p => p.id)
);

// attempt move
applyMove(state, mkMove(selected, sq));

// Explosions: anything that died due to this move (capture, suicide into hazard, star burn, etc.)
for (const p of state.pieces) {
  if (aliveBeforeAction.has(p.id) && !p.alive) {
    spawnExplosion(p.pos);
  }
}

selected = null;
legal = [];





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
  const duration = 2; // seconds
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

function spawnExplosion(sq: Square, ttl = 3000) {
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

    // Hazard trails (short-lived, shows last hazard tick step)
  const nowTrail = performance.now();
  for (let i = hazardTrails.length - 1; i >= 0; i--) {
    const t = hazardTrails[i];
    const age = nowTrail - t.t0;
    if (age >= t.ttl) {
      hazardTrails.splice(i, 1);
      continue;
    }

    const k = 1 - age / t.ttl;

    ctx.save();
    ctx.globalAlpha = 0.45 * k;
    ctx.fillStyle =
  t.kind === "comet"
    ? "rgba(255, 110, 40, 1)"   // hot orange for comets
    : "rgba(180, 190, 205, 1)"; // cool grey for asteroids

    // draw the from and to squares as soft overlays
    ctx.fillRect(x0 + t.from.c * tileSize, y0 + t.from.r * tileSize, tileSize, tileSize);
    ctx.globalAlpha = 0.60 * k;
    ctx.fillRect(x0 + t.to.c * tileSize, y0 + t.to.r * tileSize, tileSize, tileSize);

    ctx.restore();
  }


  // Deploy target highlight (White only, when deploy panel is open)
  if (deployOpen && state.sideToMove === "W" && canDeployNow(state)) {
    const homeRow = deployHomeRowFor("W");
    ctx.fillStyle = "rgba(66, 153, 225, 0.20)"; // subtle blue

    for (let c = 0; c < COLS; c++) {
      const sq = { r: homeRow, c };
      // Only highlight squares that are actually deployable
      if (pieceAt(state, sq)) continue;
      if (staticAt(state, sq)) continue;
      const hz = flyerAt(state, sq);
      if (hz && hz.alive) continue;

      ctx.fillRect(x0 + c * tileSize, y0 + homeRow * tileSize, tileSize, tileSize);
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

  let dx = 0, dy = 0;
  switch (hz.dir) {
    case "E": dx = 1; dy = 0; break;
    case "W": dx = -1; dy = 0; break;
    case "N": dx = 0; dy = -1; break;
    case "S": dx = 0; dy = 1; break;
  }

  const isAsteroid = hz.kind === "asteroid";

  const tailLen = tileSize * (isAsteroid ? 0.28 : 0.50);
  const tailWidth = tileSize * (isAsteroid ? 0.18 : 0.25);

  const tx = cx - dx * tailLen;
  const ty = cy - dy * tailLen;

  ctx.save();
  ctx.globalAlpha = isAsteroid ? 0.75 : 0.85;

  // Tail
  ctx.fillStyle = isAsteroid
    ? "rgba(180, 190, 205, 0.45)"
    : "rgba(248, 15, 3, 0.55)";

  ctx.beginPath();

  const px = -dy;
  const py = dx;

  const hx1 = cx + px * (tailWidth * 0.70);
  const hy1 = cy + py * (tailWidth * 0.70);
  const hx2 = cx - px * (tailWidth * 0.70);
  const hy2 = cy - py * (tailWidth * 0.70);

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

  // Core
  ctx.globalAlpha = 1;
  ctx.fillStyle = isAsteroid ? "#8a96a6" : "#c77e47ff";
  ctx.beginPath();
  ctx.arc(cx, cy, tileSize * (isAsteroid ? 0.15 : 0.17), 0, Math.PI * 2);
  ctx.fill();

  // Highlight
  ctx.globalAlpha = isAsteroid ? 0.65 : 0.9;
  ctx.fillStyle = isAsteroid
    ? "rgba(230, 235, 245, 0.65)"
    : "rgba(203, 165, 116, 0.85)";

  ctx.beginPath();
  ctx.arc(cx + dx * tileSize * 0.07, cy + dy * tileSize * 0.07, tileSize * 0.05, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

  // Pieces (pixel-art sprites)
for (const p of state.pieces) {
  if (!p.alive) continue;

  const cx = x0 + (p.pos.c + 0.5) * tileSize;
  const cy = y0 + (p.pos.r + 0.5) * tileSize;

  const name =
    p.type === "K" ? "King" :
    p.type === "Q" ? "Queen" :
    p.type === "R" ? "Rook" :
    p.type === "B" ? "Bishop" :
    p.type === "N" ? "Knight" :
    "Pawn";

  const key = `${p.side}_${name}`;
  const img = pieceSprites[key];

  if (!img || !img.complete) continue;

// Integer scaling for crisp pixels with min & max bounds
const minScale = 1;
const maxScale = 6; // desktop can go higher now (tweak 4–8)

// Target height: allow the piece to be ~110% of a tile so it feels "chess-sized"
const targetH = tileSize * 1.10;

// Use round so it can jump to 3 on desktop instead of sticking at 2
const scale = Math.max(
  minScale,
  Math.min(
    maxScale,
    Math.round(targetH / PIECE_H)
  )
);

const w = PIECE_W * scale;
const h = PIECE_H * scale;




  // Vertical optical centering tweak
const yOffset = Math.floor(h * 0.15); // tweak: 0.12–0.20 works well

ctx.drawImage(
  img,
  Math.round(cx - w / 2),
  Math.round(cy - h / 2 - yOffset),
  w,
  h
);


  // Heat ring (unchanged)
  if (p.heated) {
    ctx.strokeStyle = "rgba(246,224,94,0.9)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, tileSize * 0.42, 0, Math.PI * 2);
    ctx.stroke();
  }
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

    // Last Black move highlight (from + to)
  function strokeSquare(sq: Square, stroke: string, w: number) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = w;
    ctx.strokeRect(
      x0 + sq.c * tileSize + 2,
      y0 + sq.r * tileSize + 2,
      tileSize - 4,
      tileSize - 4
    );
  }

  if (lastBlackMoveFrom) strokeSquare(lastBlackMoveFrom, "rgba(229,62,62,0.85)", 2);
  if (lastBlackMoveTo) strokeSquare(lastBlackMoveTo, "rgba(229,62,62,1)", 4);



   // Factories (manufacturing) + Deploy panel UI
  const { factoryB, factoryW, panel } = getUiRects(viewW, viewH);

  function drawFactory(rect: { x: number; y: number; w: number; h: number }, points: number, active: boolean) {
    ctx.save();

    // background
    ctx.globalAlpha = active ? 1 : 0.55;
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

    // border
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

    // icon
    ctx.globalAlpha = active ? 1 : 0.45;
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = "22px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🏭", rect.x + rect.w / 2, rect.y + rect.h * 0.40);

    // number (no labels)
    ctx.font = "16px system-ui, sans-serif";
    ctx.fillText(String(points), rect.x + rect.w / 2, rect.y + rect.h * 0.78);

    ctx.restore();
  }

  // Black (top) / White (bottom)
  // "Active" glow is just: whose turn it is (and only White can deploy for now)
  drawFactory(factoryB, state.manufacturing.B, state.sideToMove === "B");
  drawFactory(factoryW, state.manufacturing.W, state.sideToMove === "W");

  // Deploy panel overlay
  if (deployOpen) {
    ctx.save();

    // Dim the board
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, viewW, viewH);

    // Panel box
    ctx.fillStyle = "rgba(20,24,32,0.92)";
    ctx.fillRect(panel.x, panel.y, panel.w, panel.h);

    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 2;
    ctx.strokeRect(panel.x, panel.y, panel.w, panel.h);

    // Panel text
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = "18px system-ui, sans-serif";
    ctx.fillText("Deploy Ship", panel.x + 16, panel.y + 14);

    ctx.font = "14px system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    const side = state.sideToMove;
    const mp = state.manufacturing[side];

    ctx.fillText(`Points: ${mp} 🏭`, panel.x + 16, panel.y + 48);
    ctx.fillText(`Selected: ${selectedDeployType} (${shipLabel(selectedDeployType)})`, panel.x + 16, panel.y + 70);

    // Ship list (only one selectable at a time)
    const choices = getDeployChoices(panel);

    for (const ch of choices) {
      const affordable = mp >= ch.cost;
      const selectedRow = ch.type === selectedDeployType;

      ctx.save();

      // row background
      ctx.fillStyle = selectedRow
        ? "rgba(72,187,120,0.22)"
        : "rgba(255,255,255,0.06)";
      ctx.globalAlpha = affordable ? 1 : 0.35;
      ctx.fillRect(ch.rect.x, ch.rect.y, ch.rect.w, ch.rect.h);

      // row border
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1;
      ctx.strokeRect(ch.rect.x, ch.rect.y, ch.rect.w, ch.rect.h);

      // row text
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.font = "14px system-ui, sans-serif";
      ctx.fillText(
        `${ch.type}  ${shipLabel(ch.type)}   —   ${ch.cost} 🏭`,
        ch.rect.x + 10,
        ch.rect.y + ch.rect.h / 2
      );

      ctx.restore();
    }


        const chosenCost = DEPLOY_COSTS[selectedDeployType];
    const need = Math.max(0, chosenCost - mp);

    if (side !== "W") {
      ctx.fillStyle = "rgba(255,120,120,0.95)";
      ctx.fillText("Deploy UI is White-only (for now).", panel.x + 16, panel.y + 92 + 5 * 30 + 10);
    } else if (mp < chosenCost) {
      ctx.fillStyle = "rgba(255,120,120,0.95)";
      ctx.fillText(`Not enough points for ${selectedDeployType}: need ${need} more.`, panel.x + 16, panel.y + 92 + 5 * 30 + 10);
    } else {
      ctx.fillStyle = "rgba(200,255,200,0.95)";
      ctx.fillText("Click a square on rank 1 to deploy.", panel.x + 16, panel.y + 92 + 5 * 30 + 10);
    }


    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillText("Click outside this panel to close.", panel.x + 16, panel.y + panel.h - 34);

    ctx.restore();
  }

    // --- Game Over overlay (wins + reset hint) ---
  if (gameOver) {
    ctx.save();

    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(0, 0, viewW, viewH);

    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "48px system-ui, sans-serif";
    ctx.fillText(
      `${gameOver.winner === "W" ? "White" : "Black"} wins`,
      viewW / 2,
      viewH / 2 - 20
    );

    ctx.font = "18px system-ui, sans-serif";
    ctx.fillText(`Press R to restart`, viewW / 2, viewH / 2 + 30);

    ctx.restore();
  }

}

function loop() {
  draw(state);
  requestAnimationFrame(loop);
}
loop();
