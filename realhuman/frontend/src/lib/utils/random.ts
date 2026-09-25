/**
 * Deterministic PRNG (mulberry32). Used for sample data so server and client
 * renders match and screenshots are stable.
 */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic lowercase hex string from a PRNG. */
export function seededHex(random: () => number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += Math.floor(random() * 16).toString(16);
  }
  return out;
}

/** Cryptographically random hex, for values that must not be predictable. */
export function secureHex(length: number): string {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, length);
}
