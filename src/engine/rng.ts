// Seeded pseudo-random number generator (mulberry32) and sampling helpers.
// Every random draw inside a mission run goes through one of these so a run
// is fully reproducible from (missionId, seed) — which is what makes the
// mission-lab balance harness and bug reports meaningful.

export type Rng = () => number; // uniform [0, 1)

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Range {
  min: number;
  max: number;
}

// Uniform draw from a range.
export function range(rng: Rng, r: Range): number {
  return r.min + rng() * (r.max - r.min);
}

// Uniform integer in [min, max] inclusive.
export function int(rng: Rng, min: number, max: number): number {
  return Math.floor(min + rng() * (max - min + 1));
}

// Uniform pick from a non-empty array.
export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

// A fresh unpredictable seed for runs where the caller didn't fix one.
export function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}
