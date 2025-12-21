// Mulberry32: small, fast deterministic PRNG
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rng: () => number, minIncl: number, maxIncl: number): number {
  return Math.floor(rng() * (maxIncl - minIncl + 1)) + minIncl;
}
