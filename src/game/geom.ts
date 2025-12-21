import type { Square } from "./types";

export function inBounds(s: Square, rows: number, cols: number): boolean {
  return s.r >= 0 && s.r < rows && s.c >= 0 && s.c < cols;
}

export function sameSq(a: Square, b: Square): boolean {
  return a.r === b.r && a.c === b.c;
}

export function isAdjacent8(a: Square, b: Square): boolean {
  const dr = Math.abs(a.r - b.r);
  const dc = Math.abs(a.c - b.c);
  return (dr <= 1 && dc <= 1) && !(dr === 0 && dc === 0);
}
