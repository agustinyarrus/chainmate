/**
 * RandomNumberGenerator — a bit-exact port of Godot 4's RandomPCG (PCG32, `pcg32_random_r`).
 *
 * Why exact: a Chainmate run is seeded with `hash(seed_text)`; the map, every encounter, every relic
 * offer and every enemy move derive from this one stream. Matching Godot's arithmetic to the bit is
 * what lets the same seed replay the same run as the original build (verified against the oracle
 * dump in `_oracle/primitives.json`).
 *
 * The 64-bit state is kept as two uint32 halves and multiplied with 16-bit limbs: no BigInt on the hot
 * path (the audio synthesiser alone draws ~300 k numbers at start-up). Every step is O(1).
 */

const F = Math.fround;

// PCG32 multiplier 6364136223846793005 = 0x5851F42D_4C957F2D, split into 16-bit limbs (low → high).
const MUL_LIMBS = [0x7f2d, 0x4c95, 0xf42d, 0x5851];
// Godot's RandomPCG::DEFAULT_INC (PCG_DEFAULT_INC_64 = 1442695040888963407 = 0x14057B7E_F767814F).
const DEFAULT_INC_HI = 0x14057b7e;
const DEFAULT_INC_LO = 0xf767814f;
const TWO_32 = 4294967296;

/**
 * 64-bit wrapping multiply-add on uint32 halves: (hi:lo) * MUL + (incHi:incLo) mod 2^64.
 * Schoolbook multiplication with 16-bit limbs keeps every partial product below 2^53 (exact in doubles).
 * O(1): 16 limb products, all integer-exact.
 */
function mulAdd64(hi, lo, incHi, incLo) {
  const a = [lo & 0xffff, lo >>> 16, hi & 0xffff, hi >>> 16];
  const out = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    let carry = 0;
    for (let j = 0; i + j < 4; j++) {
      const t = out[i + j] + a[i] * MUL_LIMBS[j] + carry;
      out[i + j] = t % 65536;
      carry = Math.floor(t / 65536);
    }
  }
  let resultLo = out[0] + out[1] * 65536 + incLo;
  let carryLo = 0;
  if (resultLo >= TWO_32) {
    resultLo -= TWO_32;
    carryLo = 1;
  }
  const resultHi = (out[2] + out[3] * 65536 + incHi + carryLo) % TWO_32;
  return [resultHi >>> 0, resultLo >>> 0];
}

/** 32-bit rotate right, PCG's output permutation. */
function rotr32(value, rot) {
  return ((value >>> rot) | (value << ((32 - rot) & 31))) >>> 0;
}

export class RandomNumberGenerator {
  constructor() {
    this._hi = 0;
    this._lo = 0;
    this._incHi = 0;
    this._incLo = 0;
    this._seedHi = 0;
    this._seedLo = 0;
    this.randomize(); // Godot 4: `RandomNumberGenerator.new()` starts randomized.
  }

  /** `rng.seed = value` — accepts a number (≤ 2^53) or a BigInt (full uint64). */
  set seed(value) {
    const big = BigInt.asUintN(64, BigInt(value));
    this._seedHi = Number(big >> 32n);
    this._seedLo = Number(big & 0xffffffffn);
    this._reseed();
  }

  /** Godot returns the seed as a (signed) int64. */
  get seed() {
    return BigInt.asIntN(64, (BigInt(this._seedHi) << 32n) | BigInt(this._seedLo));
  }

  /** `rng.state` — the raw PCG state, signed int64 like GDScript prints it. */
  get state() {
    return BigInt.asIntN(64, (BigInt(this._hi) << 32n) | BigInt(this._lo));
  }

  set state(value) {
    const big = BigInt.asUintN(64, BigInt(value));
    this._hi = Number(big >> 32n);
    this._lo = Number(big & 0xffffffffn);
  }

  /** pcg32_srandom_r(state = seed, seq = DEFAULT_INC). */
  _reseed() {
    // inc = (initseq << 1) | 1
    this._incHi = ((DEFAULT_INC_HI << 1) | (DEFAULT_INC_LO >>> 31)) >>> 0;
    this._incLo = ((DEFAULT_INC_LO << 1) | 1) >>> 0;
    this._hi = 0;
    this._lo = 0;
    this._next();
    // state += initstate (64-bit add)
    let lo = this._lo + this._seedLo;
    let carry = 0;
    if (lo >= TWO_32) {
      lo -= TWO_32;
      carry = 1;
    }
    this._lo = lo >>> 0;
    this._hi = (this._hi + this._seedHi + carry) % TWO_32 >>> 0;
    this._next();
  }

  randomize() {
    const words = new Uint32Array(2);
    if (globalThis.crypto?.getRandomValues) {
      globalThis.crypto.getRandomValues(words);
    } else {
      words[0] = (Math.random() * TWO_32) >>> 0;
      words[1] = (Math.random() * TWO_32) >>> 0;
    }
    this._seedHi = words[0];
    this._seedLo = words[1];
    this._reseed();
  }

  /** pcg32_random_r: one uint32. */
  _next() {
    const oldHi = this._hi;
    const oldLo = this._lo;
    [this._hi, this._lo] = mulAdd64(oldHi, oldLo, this._incHi, this._incLo);
    // xorshifted = ((old >> 18) ^ old) >> 27, truncated to 32 bits.
    const shiftedHi = oldHi >>> 18;
    const shiftedLo = ((oldLo >>> 18) | (oldHi << 14)) >>> 0;
    const xHi = (shiftedHi ^ oldHi) >>> 0;
    const xLo = (shiftedLo ^ oldLo) >>> 0;
    const xorshifted = ((xLo >>> 27) | (xHi << 5)) >>> 0;
    const rot = oldHi >>> 27; // old >> 59
    return rotr32(xorshifted, rot);
  }

  /** `randi()` — uint32. */
  randi() {
    return this._next();
  }

  /** pcg32_boundedrand_r — Lemire-free rejection sampling exactly like PCG's reference code. */
  _bounded(bound) {
    const threshold = ((TWO_32 - bound) % bound) >>> 0;
    for (;;) {
      const r = this._next();
      if (r >= threshold) return r % bound;
    }
  }

  /** `randi_range(from, to)` — inclusive; equal bounds return without consuming the stream. */
  randi_range(from, to) {
    if (from === to) return from;
    const bound = (Math.abs(from - to) + 1) >>> 0;
    return this._bounded(bound) + Math.min(from, to);
  }

  /**
   * `randf()` — float32 in [0, 1]. Godot samples the bits as the fraction of an infinite binary number:
   * first word sets the exponent (leading zeros), second word the significand with MSB/LSB forced on.
   */
  randf() {
    const protoExpOffset = this._next();
    if (protoExpOffset === 0) return 0;
    const significand = (this._next() | 0x80000001) >>> 0;
    return F(significand) * Math.pow(2, -32 - Math.clz32(protoExpOffset));
  }

  /** `randf_range(from, to)` — computed in float32 like `RandomPCG::random(float, float)`. */
  randf_range(from, to) {
    const a = F(from);
    const b = F(to);
    return F(F(this.randf() * F(b - a)) + a);
  }

  /** `randfn(mean, deviation)` — Box-Muller in float32 (not used by the game logic, kept for parity). */
  randfn(mean = 0, deviation = 1) {
    let temp = this.randf();
    if (temp < 1e-7) temp = 1e-7;
    return F(F(mean) + F(F(deviation) * F(F(Math.cos(F(Math.PI * 2 * this.randf()))) * F(Math.sqrt(F(-2 * F(Math.log(temp))))))));
  }
}

/** The engine-wide generator behind GDScript's global `randf()`, `randi()`, `randf_range()`. */
export const globalRng = new RandomNumberGenerator();
export const randf = () => globalRng.randf();
export const randi = () => globalRng.randi();
export const randf_range = (a, b) => globalRng.randf_range(a, b);
export const randi_range = (a, b) => globalRng.randi_range(a, b);

/**
 * GDScript `hash(String)` / `hash(StringName)` — djb2 over UTF-32 code points (Godot's String::hash).
 * O(n) in the number of code points.
 */
export function hashString(text) {
  let h = 5381;
  for (const ch of text) {
    h = (Math.imul(h, 33) + ch.codePointAt(0)) >>> 0;
  }
  return h;
}
