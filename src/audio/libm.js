/**
 * libm — the transcendental functions as the original build computes them.
 *
 * Everything else in the synthesiser is IEEE-754 arithmetic, identical in any language. These
 * functions are not: a JavaScript engine and a C library may disagree in the last bit, and near a
 * zero of the sine they disagree a lot more. The original is a Windows build whose C runtime leaves
 * sin, cos, exp, log and pow to the x87 floating-point unit, and what that produces follows one rule
 * (measured over 28 000 seeded arguments, _oracle/probe_audio.gd, without an exception):
 *
 *     the exact value — trigonometric arguments reduced with the unit's own 66-bit π —
 *     rounded to the 64 significant bits of an x87 register, then to a double.
 *
 * This module implements that rule, so the synthesised buffers match the original's in every bit and
 * do not depend on the browser's Math library:
 *   - sin and cos (about 108 000 calls per build) run in double-double arithmetic, 106 bits, and hand
 *     over to exact integers in the one-in-a-billion case where that is not enough to decide;
 *   - exp, log and pow (about 1 000 calls) are evaluated with exact integers straight away.
 *
 * tan and tanh are the runtime's. The original's come from code that does not follow the rule (they
 * differ from it by one unit in the last place for 4 % of the arguments) and cannot be reproduced
 * from outside; the synthesiser only uses them where a last-bit difference disappears in the
 * single-precision result, which test/audio.test.mjs confirms sample by sample.
 *
 * Costs: sin, cos O(1) with about 400 floating-point operations; exp, log, pow O(precision²).
 */

// ─────────────────────────────────────────────────────────────── bits of a double ──────────────

const FLOAT = new Float64Array(1);
const WORDS = new Uint32Array(FLOAT.buffer);
FLOAT[0] = 1;
/** Index of the word that holds sign and exponent (1 on little-endian machines). */
const HIGH = WORDS[1] !== 0 ? 1 : 0;
const LOW = 1 - HIGH;
const EXPONENT_BIAS = 1023;
const MANTISSA_BITS = 52;

/** 2^n, exact, for a normal double. */
function powerOfTwo(n) {
  WORDS[HIGH] = (n + EXPONENT_BIAS) << 20;
  WORDS[LOW] = 0;
  return FLOAT[0];
}

// ─────────────────────────────────────────────────────────────── exact integers ────────────────

/** Fractional bits of the fixed point the exact evaluations run in. */
const PRECISION = 192n;
const ONE = 1n << PRECISION;
/** Significant bits of an x87 register and of a double. */
const EXTENDED_BITS = 64;
const DOUBLE_BITS = 53;
const SERIES_LIMIT = 400n;
/** Arguments are divided by 2^this before the exponential series, and the result squared back. */
const EXP_HALVINGS = 12;
/** Smallest magnitude the fixed point represents exactly. */
const EXACT_MIN = 1e-30;
const EXP_LIMIT = 700;

const mul = (a, b) => (a * b) >> PRECISION;
const div = (a, b) => (a << PRECISION) / b;

/** double → fixed point, exact. */
function fromDouble(x) {
  FLOAT[0] = x;
  const high = WORDS[HIGH];
  const exponent = (high >>> 20) & 0x7ff;
  const mantissa = (BigInt(high & 0xfffff) << 32n) | BigInt(WORDS[LOW]) | (exponent !== 0 ? 1n << 52n : 0n);
  const shift = PRECISION + BigInt((exponent || 1) - EXPONENT_BIAS - MANTISSA_BITS);
  const value = shift >= 0n ? mantissa << shift : mantissa >> -shift;
  return high >>> 31 ? -value : value;
}

/** Rounds to `bits` significant bits, halves to even. */
function roundBits(value, bits) {
  const negative = value < 0n;
  let v = negative ? -value : value;
  if (v === 0n) return 0n;
  const drop = BigInt(v.toString(2).length - bits);
  if (drop > 0n) {
    const half = 1n << (drop - 1n);
    const rest = v & ((1n << drop) - 1n);
    v >>= drop;
    if (rest > half || (rest === half && (v & 1n) === 1n)) v += 1n;
    v <<= drop;
  }
  return negative ? -v : v;
}

/** Fixed point holding at most 53 significant bits → double, exact. */
function toDouble(value) {
  const negative = value < 0n;
  const v = negative ? -value : value;
  if (v === 0n) return 0;
  const shift = Math.max(0, v.toString(2).length - DOUBLE_BITS);
  const result = Number(v >> BigInt(shift)) * powerOfTwo(shift - Number(PRECISION));
  return negative ? -result : result;
}

/** The rule's two roundings: through the register, into a double. */
const throughRegister = (value) => toDouble(roundBits(roundBits(value, EXTENDED_BITS), DOUBLE_BITS));

function atanhSeries(x) {
  const x2 = mul(x, x);
  let term = x;
  let sum = x;
  for (let k = 1n; term !== 0n && k < SERIES_LIMIT; k++) {
    term = mul(term, x2);
    sum += term / (2n * k + 1n);
  }
  return sum;
}

function sinSeries(x) {
  const x2 = mul(x, x);
  let term = x;
  let sum = x;
  for (let k = 1n; term !== 0n && k < SERIES_LIMIT; k++) {
    term = -mul(term, x2) / (2n * k * (2n * k + 1n));
    sum += term;
  }
  return sum;
}

function cosSeries(x) {
  const x2 = mul(x, x);
  let term = ONE;
  let sum = ONE;
  for (let k = 1n; term !== 0n && k < SERIES_LIMIT; k++) {
    term = -mul(term, x2) / ((2n * k - 1n) * 2n * k);
    sum += term;
  }
  return sum;
}

/** e^r for |r| well under one. */
function expSeries(r) {
  const small = r >> BigInt(EXP_HALVINGS);
  let term = ONE;
  let sum = ONE;
  for (let n = 1n; term !== 0n && n < SERIES_LIMIT; n++) {
    term = mul(term, small) / n;
    sum += term;
  }
  for (let i = 0; i < EXP_HALVINGS; i++) sum = mul(sum, sum);
  return sum;
}

/** Nearest integer to a / b (b > 0). */
function nearest(a, b) {
  const shifted = 2n * a + b;
  const quotient = shifted / (2n * b);
  return shifted < 0n && shifted % (2n * b) !== 0n ? quotient - 1n : quotient;
}

const LN2 = 2n * atanhSeries(ONE / 3n);
/** The floating-point unit's π: 66 bits, 0.C90FDAA2 2168C234 C × 4. */
const PI_66_BITS = 0xc90fdaa22168c234cn;
const HALF_PI_66 = PI_66_BITS << (PRECISION - 67n);

/** ln of a positive fixed-point value. */
function logFixed(x) {
  let exponent = 0n;
  let m = x;
  const upper = ONE + (ONE >> 1n);
  while (m >= upper) {
    m >>= 1n;
    exponent += 1n;
  }
  const lower = upper >> 1n;
  while (m < lower) {
    m <<= 1n;
    exponent -= 1n;
  }
  return exponent * LN2 + 2n * atanhSeries(div(m - ONE, m + ONE));
}

/** e^y as a double, by the rule; y is fixed point. */
function expFixed(y) {
  const k = nearest(y, LN2);
  return throughRegister(expSeries(y - k * LN2)) * powerOfTwo(Number(k));
}

/** [sin, cos] of x by quadrant, exact, with the 66-bit π. */
function exactQuadrant(x) {
  const fixed = fromDouble(x);
  const k = nearest(fixed, HALF_PI_66);
  return { r: fixed - k * HALF_PI_66, quadrant: Number(((k % 4n) + 4n) % 4n) };
}

function exactSin(x) {
  const { r, quadrant } = exactQuadrant(x);
  const value = quadrant % 2 === 0 ? sinSeries(r) : cosSeries(r);
  return throughRegister(quadrant >= 2 ? -value : value);
}

function exactCos(x) {
  const { r, quadrant } = exactQuadrant(x);
  const value = quadrant % 2 === 0 ? cosSeries(r) : sinSeries(r);
  return throughRegister(quadrant === 1 || quadrant === 2 ? -value : value);
}

export function exp(x) {
  if (x === 0) return 1;
  if (!(Math.abs(x) <= EXP_LIMIT) || Math.abs(x) < EXACT_MIN) return Math.exp(x);
  return expFixed(fromDouble(x));
}

export function log(x) {
  if (x === 1) return 0;
  if (!(x > 0) || x === Infinity || x < EXACT_MIN) return Math.log(x);
  return throughRegister(logFixed(fromDouble(x)));
}

/** Positive bases only follow the rule here (all the synthesiser needs); the rest is the runtime's. */
export function pow(base, exponent) {
  if (exponent === 0 || base === 1) return 1;
  if (!(base > 0) || base === Infinity || base < EXACT_MIN || !Number.isFinite(exponent)) return Math.pow(base, exponent);
  if (Math.abs(exponent) < EXACT_MIN) return Math.pow(base, exponent);
  const y = mul(fromDouble(exponent), logFixed(fromDouble(base)));
  if (y > BigInt(EXP_LIMIT) * ONE || y < -BigInt(EXP_LIMIT) * ONE) return Math.pow(base, exponent);
  return expFixed(y);
}

export const tan = Math.tan;
export const tanh = Math.tanh;

// ─────────────────────────────────────────────────────────────── double-double ─────────────────
// A value is carried as an unevaluated sum of two doubles, hi + lo with |lo| ≤ ulp(hi) / 2. The
// functions return hi and leave lo in LO_WORD (no allocation on the hot path).

/** 2^27 + 1: splits a double into two halves of 26 bits (Dekker). */
const SPLITTER = 134217729;
let LO_WORD = 0;

/** a + b exactly (Knuth). */
function twoSum(a, b) {
  const sum = a + b;
  const bb = sum - a;
  LO_WORD = a - (sum - bb) + (b - bb);
  return sum;
}

/** a + b exactly when |a| ≥ |b| (Dekker). */
function quickTwoSum(a, b) {
  const sum = a + b;
  LO_WORD = b - (sum - a);
  return sum;
}

/** a · b exactly. */
function twoProduct(a, b) {
  const product = a * b;
  const ca = SPLITTER * a;
  const aHigh = ca - (ca - a);
  const aLow = a - aHigh;
  const cb = SPLITTER * b;
  const bHigh = cb - (cb - b);
  const bLow = b - bHigh;
  LO_WORD = aHigh * bHigh - product + aHigh * bLow + aLow * bHigh + aLow * bLow;
  return product;
}

function multiply(aHigh, aLow, bHigh, bLow) {
  const product = twoProduct(aHigh, bHigh);
  return quickTwoSum(product, LO_WORD + (aHigh * bLow + aLow * bHigh));
}

function add(aHigh, aLow, bHigh, bLow) {
  const sum = twoSum(aHigh, bHigh);
  const sumError = LO_WORD;
  const low = twoSum(aLow, bLow);
  const lowError = LO_WORD;
  const high = quickTwoSum(sum, sumError + low);
  return quickTwoSum(high, lowError + LO_WORD);
}

/** Fixed point → double-double. */
function toPair(value) {
  const high = toDouble(roundBits(value, DOUBLE_BITS));
  return [high, toDouble(roundBits(value - fromDouble(high), DOUBLE_BITS))];
}

/** Taylor terms past the first: sin r = r·(1 + Σ sₙ zⁿ), cos r = 1 + Σ cₙ zⁿ, z = r², n = 1‥. */
const SIN_TERMS = 15;
const COS_TERMS = 16;
/** Terms from this one on are small enough for plain doubles. */
const PLAIN_FROM = 9;

function seriesCoefficients(terms, denominator) {
  const pairs = [];
  let factorial = 1n;
  let upTo = 0n;
  for (let n = 1; n <= terms; n++) {
    const target = denominator(BigInt(n));
    while (upTo < target) factorial *= ++upTo;
    const value = ONE / factorial;
    pairs.push(toPair(n % 2 === 1 ? -value : value));
  }
  return { high: Float64Array.from(pairs, (pair) => pair[0]), low: Float64Array.from(pairs, (pair) => pair[1]) };
}

const SIN_SERIES = seriesCoefficients(SIN_TERMS, (n) => 2n * n + 1n);
const COS_SERIES = seriesCoefficients(COS_TERMS, (n) => 2n * n);

/** π₆₆ / 2 as two doubles, exactly: 53 bits and the 14 that are left. */
const HALF_PI_HIGH = toDouble((PI_66_BITS >> 15n) << (PRECISION - 52n));
const HALF_PI_LOW = toDouble((PI_66_BITS & 0x7fffn) << (PRECISION - 67n));
const TWO_OVER_PI = 0.6366197723675814;
const QUARTER_PI = 0.7853981633974483;
/** Beyond this the quadrant count no longer multiplies exactly: exact integers take over. */
const FAST_LIMIT = 1e6;
/** Under 2^-27 the sine is its argument and the cosine is one, to the last bit of the rule. */
const TINY = 7.450580596923828e-9;

/** Σ coefficientₙ zⁿ for n = 1‥terms (Horner): the small terms in doubles, the rest in pairs. */
function series(coefficients, terms, zHigh, zLow) {
  const { high, low } = coefficients;
  let plain = high[terms - 1];
  for (let n = terms - 1; n >= PLAIN_FROM; n--) plain = plain * zHigh + high[n - 1];
  let accHigh = plain;
  let accLow = 0;
  for (let n = PLAIN_FROM - 1; n >= 1; n--) {
    accHigh = multiply(accHigh, accLow, zHigh, zLow);
    accHigh = add(accHigh, LO_WORD, high[n - 1], low[n - 1]);
    accLow = LO_WORD;
  }
  return multiply(accHigh, accLow, zHigh, zLow);
}

let REDUCED_LOW = 0;
let QUADRANT = 0;

/** x − k·π₆₆/2 for the nearest k, exact; returns the high word (low word and quadrant on the side). */
function reduce(x) {
  if (Math.abs(x) <= QUARTER_PI) {
    REDUCED_LOW = 0;
    QUADRANT = 0;
    return x;
  }
  const k = Math.round(x * TWO_OVER_PI);
  const product = twoProduct(k, HALF_PI_HIGH);
  const productLow = LO_WORD;
  let high = twoSum(x, -product);
  let low = LO_WORD;
  high = twoSum(high, -productLow);
  low += LO_WORD;
  high = twoSum(high, low);
  low = LO_WORD;
  high = twoSum(high, -(k * HALF_PI_LOW));
  low += LO_WORD;
  high = twoSum(high, low);
  REDUCED_LOW = LO_WORD;
  QUADRANT = ((k % 4) + 4) % 4;
  return high;
}

/** sin of a reduced argument, as a pair. */
function sinReduced(rHigh, rLow) {
  const zHigh = multiply(rHigh, rLow, rHigh, rLow);
  const tail = series(SIN_SERIES, SIN_TERMS, zHigh, LO_WORD);
  const scaled = multiply(rHigh, rLow, tail, LO_WORD);
  return add(rHigh, rLow, scaled, LO_WORD);
}

function cosReduced(rHigh, rLow) {
  const zHigh = multiply(rHigh, rLow, rHigh, rLow);
  const tail = series(COS_SERIES, COS_TERMS, zHigh, LO_WORD);
  return add(1, 0, tail, LO_WORD);
}

/** The pair is this close (in units of the last place) to where the rule changes its answer. */
const UNDECIDED = powerOfTwo(-36);
/** Half a unit of the register, in units of the double's last place. */
const REGISTER_HALF = powerOfTwo(-12);

/**
 * The rule's two roundings applied to a pair. The answer is `high` unless the value lies within half
 * a register unit of the midpoint between two doubles: the register then holds the midpoint itself,
 * and the second rounding goes to the even neighbour. Returns NaN when the pair cannot decide.
 */
function roundPair(high, low) {
  if (low === 0) return high;
  FLOAT[0] = high;
  const highWord = WORDS[HIGH];
  const exponent = (highWord >>> 20) & 0x7ff;
  if (exponent <= MANTISSA_BITS + 1) return NaN;
  const even = (WORDS[LOW] & 1) === 0;
  const powerOfTwoBelow = (highWord & 0xfffff) === 0 && WORDS[LOW] === 0 && low < 0 === high > 0;
  if (even || powerOfTwoBelow) return high;
  const unit = powerOfTwo(exponent - EXPONENT_BIAS - MANTISSA_BITS);
  const excess = Math.abs(low) / unit - (0.5 - REGISTER_HALF);
  if (excess < -UNDECIDED) return high;
  if (excess <= UNDECIDED) return NaN;
  return low > 0 ? high + unit : high - unit;
}

export function sin(x) {
  if (!Number.isFinite(x)) return NaN;
  if (Math.abs(x) < TINY) return x;
  if (Math.abs(x) > FAST_LIMIT) return exactSin(x);
  const rHigh = reduce(x);
  const quadrant = QUADRANT;
  const high = quadrant % 2 === 0 ? sinReduced(rHigh, REDUCED_LOW) : cosReduced(rHigh, REDUCED_LOW);
  const rounded = roundPair(high, LO_WORD);
  if (Number.isNaN(rounded)) return exactSin(x);
  return quadrant >= 2 ? -rounded : rounded;
}

export function cos(x) {
  if (!Number.isFinite(x)) return NaN;
  if (Math.abs(x) < TINY) return 1;
  if (Math.abs(x) > FAST_LIMIT) return exactCos(x);
  const rHigh = reduce(x);
  const quadrant = QUADRANT;
  const high = quadrant % 2 === 0 ? cosReduced(rHigh, REDUCED_LOW) : sinReduced(rHigh, REDUCED_LOW);
  const rounded = roundPair(high, LO_WORD);
  if (Number.isNaN(rounded)) return exactCos(x);
  return quadrant === 1 || quadrant === 2 ? -rounded : rounded;
}

/** The exact evaluations on their own: what the fast path is tested against. */
export const exact = Object.freeze({ sin: exactSin, cos: exactCos });
