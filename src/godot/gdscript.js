/**
 * GDScript runtime semantics the port relies on — the parts where JavaScript quietly differs:
 *
 *  - `sort_custom` / `sort`: Godot uses an introsort that is NOT stable above 16 items. JS sort is
 *    stable, so ties would come out in a different order (and the game picks `array[0]` after sorting).
 *  - Variant equality is by value (`[Vector2i(1,2)].has(Vector2i(1,2))`, dictionaries compared deeply).
 *  - Dictionaries keep insertion order for ANY key type; JS objects reorder integer-like keys.
 *  - `str(float)` and the `%` operator print numbers Godot's way ("1.0", "%d" truncation, "%.1f" rounding).
 *
 * All of it is verified against `_oracle/primitives.json` (see test/gdscript.test.mjs).
 */
import { Vector2, Vector2i, Vector3, Color } from './math.js';

// ───────────────────────────────────────────────────────────────── equality & copies ───────────

/** Variant `==`: numbers/strings/bools by value, math types by components, containers deeply. */
export function variantEquals(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (typeof a.equals === 'function') return a.equals(b);
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!variantEquals(a[i], b[i])) return false;
    return true;
  }
  if (a instanceof GDict) return b instanceof GDict && a.equals(b);
  if (Array.isArray(b) || b instanceof GDict) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const key of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, key) || !variantEquals(a[key], b[key])) return false;
  }
  return true;
}

/** Array.has(value) — O(n) with value equality. */
export const has = (array, value) => array.some((item) => variantEquals(item, value));
/** Array.find(value) → index or -1. */
export const find = (array, value) => array.findIndex((item) => variantEquals(item, value));
/** Array.count(value). */
export const count = (array, value) => array.reduce((n, item) => n + (variantEquals(item, value) ? 1 : 0), 0);
/** Array.erase(value): removes the FIRST equal item, in place. */
export function erase(array, value) {
  const index = find(array, value);
  if (index >= 0) array.splice(index, 1);
}

/** `duplicate(deep)` for arrays, plain dictionaries, GDicts and math values. */
export function duplicate(value, deep = false) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return deep ? value.map((v) => duplicate(v, true)) : value.slice();
  if (value instanceof GDict) return value.duplicate(deep);
  if (value instanceof Vector2 || value instanceof Vector2i || value instanceof Vector3 || value instanceof Color) return value.clone();
  const out = {};
  for (const key of Object.keys(value)) out[key] = deep ? duplicate(value[key], true) : value[key];
  return out;
}

// ───────────────────────────────────────────────────────────────── dictionaries ────────────────

/** Canonical map key for a Variant key (Godot hashes dictionary keys by value). */
function keyOf(key) {
  if (key === null || key === undefined) return 'nil';
  switch (typeof key) {
    case 'string': return `s:${key}`;
    case 'number': return Number.isInteger(key) ? `i:${key}` : `f:${key}`;
    case 'boolean': return `b:${key}`;
    default:
      if (typeof key.key === 'function') return `${key.constructor.name}:${key.key()}`;
      return `j:${JSON.stringify(key)}`;
  }
}

/**
 * Dictionary with Variant keys and insertion order — for keys that are not plain identifiers
 * (Vector2i cells, ints). O(1) get/set/has/erase via a canonical-key Map.
 */
export class GDict {
  constructor(entries = []) {
    this._map = new Map();
    for (const [k, v] of entries) this.set(k, v);
  }
  get size() { return this._map.size; }
  has(key) { return this._map.has(keyOf(key)); }
  get(key, fallback = undefined) {
    const entry = this._map.get(keyOf(key));
    return entry ? entry[1] : fallback;
  }
  set(key, value) {
    const k = keyOf(key);
    const entry = this._map.get(k);
    if (entry) entry[1] = value;
    else this._map.set(k, [key, value]);
  }
  erase(key) { return this._map.delete(keyOf(key)); }
  clear() { this._map.clear(); }
  keys() { return Array.from(this._map.values(), (e) => e[0]); }
  values() { return Array.from(this._map.values(), (e) => e[1]); }
  entries() { return Array.from(this._map.values(), (e) => [e[0], e[1]]); }
  is_empty() { return this._map.size === 0; }
  [Symbol.iterator]() { return this.keys()[Symbol.iterator](); }
  duplicate(deep = false) {
    const copy = new GDict();
    for (const [k, v] of this.entries()) copy.set(k, deep ? duplicate(v, true) : v);
    return copy;
  }
  equals(other) {
    if (!(other instanceof GDict) || other.size !== this.size) return false;
    for (const [k, v] of this.entries()) if (!other.has(k) || !variantEquals(other.get(k), v)) return false;
    return true;
  }
}

// ───────────────────────────────────────────────────────────────── sorting (introsort) ─────────

const INTROSORT_THRESHOLD = 16;

/**
 * Port of Godot's `SortArray` (core/templates/sort_array.h): introsort with median-of-3 partitioning,
 * heapsort fallback past 2·log2(n) depth, and a final insertion sort. O(n log n) worst case.
 * Reproducing it exactly matters because it is not stable: equal keys land where Godot puts them.
 * `less(a, b)` is the GDScript comparator (true when a must come before b). Sorts in place.
 */
export function sortCustom(array, less) {
  const n = array.length;
  if (n > 0) {
    introsort(array, 0, n, less, bitlog(n) * 2);
    finalInsertionSort(array, 0, n, less);
  }
  return array;
}

function bitlog(n) {
  let k = 0;
  for (; n !== 1; n >>= 1) k++;
  return k;
}

function medianOf3(a, b, c, less) {
  if (less(a, b)) {
    if (less(b, c)) return b;
    if (less(a, c)) return c;
    return a;
  }
  if (less(a, c)) return a;
  if (less(b, c)) return c;
  return b;
}

function partitioner(array, first, last, pivot, less) {
  for (;;) {
    while (less(array[first], pivot)) first++;
    last--;
    while (less(pivot, array[last])) last--;
    if (!(first < last)) return first;
    const swap = array[first];
    array[first] = array[last];
    array[last] = swap;
    first++;
  }
}

function introsort(array, first, last, less, maxDepth) {
  while (last - first > INTROSORT_THRESHOLD) {
    if (maxDepth === 0) {
      partialSort(array, first, last, last, less);
      return;
    }
    maxDepth--;
    const cut = partitioner(array, first, last, medianOf3(array[first], array[first + Math.trunc((last - first) / 2)], array[last - 1], less), less);
    introsort(array, cut, last, less, maxDepth);
    last = cut;
  }
}

function pushHeap(array, first, holeIdx, topIndex, value, less) {
  let parent = Math.trunc((holeIdx - 1) / 2);
  while (holeIdx > topIndex && less(array[first + parent], value)) {
    array[first + holeIdx] = array[first + parent];
    holeIdx = parent;
    parent = Math.trunc((holeIdx - 1) / 2);
  }
  array[first + holeIdx] = value;
}

function adjustHeap(array, first, holeIdx, len, value, less) {
  const topIndex = holeIdx;
  let secondChild = 2 * holeIdx + 2;
  while (secondChild < len) {
    if (less(array[first + secondChild], array[first + (secondChild - 1)])) secondChild--;
    array[first + holeIdx] = array[first + secondChild];
    holeIdx = secondChild;
    secondChild = 2 * (secondChild + 1);
  }
  if (secondChild === len) {
    array[first + holeIdx] = array[first + (secondChild - 1)];
    holeIdx = secondChild - 1;
  }
  pushHeap(array, first, holeIdx, topIndex, value, less);
}

function popHeapTo(array, first, last, result, value, less) {
  array[result] = array[first];
  adjustHeap(array, first, 0, last - first, value, less);
}

function makeHeap(array, first, last, less) {
  if (last - first < 2) return;
  const len = last - first;
  let parent = Math.trunc((len - 2) / 2);
  for (;;) {
    adjustHeap(array, first, parent, len, array[first + parent], less);
    if (parent === 0) return;
    parent--;
  }
}

function sortHeap(array, first, last, less) {
  while (last - first > 1) {
    last--;
    popHeapTo(array, first, last, last, array[last], less);
  }
}

function partialSort(array, first, last, middle, less) {
  makeHeap(array, first, middle, less);
  for (let i = middle; i < last; i++) {
    if (less(array[i], array[first])) popHeapTo(array, first, middle, i, array[i], less);
  }
  sortHeap(array, first, middle, less);
}

function unguardedLinearInsert(array, last, value, less) {
  let next = last - 1;
  while (less(value, array[next])) {
    array[last] = array[next];
    last = next;
    next--;
  }
  array[last] = value;
}

function linearInsert(array, first, last, less) {
  const value = array[last];
  if (less(value, array[first])) {
    for (let i = last; i > first; i--) array[i] = array[i - 1];
    array[first] = value;
  } else {
    unguardedLinearInsert(array, last, value, less);
  }
}

function insertionSort(array, first, last, less) {
  if (first === last) return;
  for (let i = first + 1; i !== last; i++) linearInsert(array, first, i, less);
}

function finalInsertionSort(array, first, last, less) {
  if (last - first > INTROSORT_THRESHOLD) {
    insertionSort(array, first, first + INTROSORT_THRESHOLD, less);
    for (let i = first + INTROSORT_THRESHOLD; i !== last; i++) unguardedLinearInsert(array, i, array[i], less);
  } else {
    insertionSort(array, first, last, less);
  }
}

/** Variant `<` used by `Array.sort()`: numbers numerically, strings by code point. */
export function variantLess(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a < b;
  if (typeof a === 'string' && typeof b === 'string') {
    const ca = Array.from(a, (ch) => ch.codePointAt(0));
    const cb = Array.from(b, (ch) => ch.codePointAt(0));
    const n = Math.min(ca.length, cb.length);
    for (let i = 0; i < n; i++) if (ca[i] !== cb[i]) return ca[i] < cb[i];
    return ca.length < cb.length;
  }
  return String(a) < String(b);
}

/** `Array.sort()` — in place, Godot's ordering. */
export const sort = (array) => sortCustom(array, variantLess);

// ───────────────────────────────────────────────────────────────── text ────────────────────────

/** `String::num(x)` with Godot's default precision (14 decimals, minus the integer digits). */
function numDefault(value) {
  if (Number.isNaN(value)) return 'nan';
  if (!Number.isFinite(value)) return value > 0 ? 'inf' : '-inf';
  let decimals = 14;
  const magnitude = Math.abs(value);
  if (magnitude > 10) decimals -= Math.floor(Math.log10(magnitude));
  decimals = Math.max(0, Math.min(decimals, 16));
  let text = value.toFixed(decimals);
  if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '');
  if (text === '-0') text = '0';
  return text;
}

/** GDScript `str(float)`: like `String::num` but always shows a decimal point ("1.0"). */
export function floatToString(value) {
  const text = numDefault(value);
  return /[.ne]/.test(text) ? text : `${text}.0`;
}

/**
 * GDScript `str(value)`. Integers are JS integers here, so a whole-number double that GDScript would
 * print as "1.0" must be passed through `floatToString` explicitly by the ported code.
 */
export function str(value) {
  if (value === null || value === undefined) return '<null>';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : floatToString(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return `[${value.map(strInContainer).join(', ')}]`;
  if (value instanceof GDict) return `{ ${value.entries().map(([k, v]) => `${strInContainer(k)}: ${strInContainer(v)}`).join(', ')} }`;
  if (typeof value.toString === 'function' && value.toString !== Object.prototype.toString) return value.toString();
  return `{ ${Object.entries(value).map(([k, v]) => `"${k}": ${strInContainer(v)}`).join(', ')} }`;
}
const strInContainer = (v) => (typeof v === 'string' ? `"${v}"` : str(v));

/**
 * GDScript's `"fmt" % args` (String::sprintf): %s %d %i %f %x %X %o %c %% with flags `+ - 0`, width and
 * precision. `%d` truncates floats; `%.Nf` rounds like the engine (ties away from zero on the decimal
 * expansion — `toFixed` does the same).
 */
export function format(fmt, args) {
  const values = Array.isArray(args) ? args : [args];
  let index = 0;
  return fmt.replace(/%([+\-0 ]*)(\d+|\*)?(?:\.(\d+|\*))?([sdifxXoc%v])/g, (match, flags, width, precision, type) => {
    if (type === '%') return '%';
    if (width === '*') width = String(values[index++]);
    if (precision === '*') precision = String(values[index++]);
    const value = values[index++];
    let text;
    switch (type) {
      case 's':
        text = str(value);
        break;
      case 'd':
      case 'i': {
        const n = typeof value === 'number' ? Math.trunc(value) : Number(value);
        text = String(Math.abs(n));
        if (n < 0) text = `-${text}`;
        else if (flags.includes('+')) text = `+${text}`;
        break;
      }
      case 'f': {
        const digits = precision === undefined ? 6 : Number(precision);
        text = Math.abs(value).toFixed(digits);
        if (value < 0 || Object.is(value, -0)) text = `-${text}`;
        else if (flags.includes('+')) text = `+${text}`;
        break;
      }
      case 'x':
        text = Math.trunc(value).toString(16);
        break;
      case 'X':
        text = Math.trunc(value).toString(16).toUpperCase();
        break;
      case 'o':
        text = Math.trunc(value).toString(8);
        break;
      case 'c':
        text = typeof value === 'number' ? String.fromCodePoint(value) : String(value)[0];
        break;
      case 'v':
        text = str(value);
        break;
      default:
        return match;
    }
    if (width !== undefined) {
      const w = Number(width);
      if (flags.includes('-')) text = text.padEnd(w, ' ');
      else if (flags.includes('0') && /[dif]/.test(type)) {
        const sign = /^[+-]/.test(text) ? text[0] : '';
        text = sign + text.slice(sign.length).padStart(w - sign.length, '0');
      } else text = text.padStart(w, ' ');
    }
    return text;
  });
}

/** Godot `to_upper()`: per code point simple case mapping (so "ß" stays "ß", unlike JS). */
export function toUpper(text) {
  let out = '';
  for (const ch of text) {
    const upper = ch.toUpperCase();
    out += Array.from(upper).length === 1 ? upper : ch;
  }
  return out;
}
export function toLower(text) {
  let out = '';
  for (const ch of text) {
    const lower = ch.toLowerCase();
    out += Array.from(lower).length === 1 ? lower : ch;
  }
  return out;
}

const isUpper = (ch) => ch !== ch.toLowerCase() && ch === ch.toUpperCase();
const isLower = (ch) => ch !== ch.toUpperCase() && ch === ch.toLowerCase();
const isDigit = (ch) => ch >= '0' && ch <= '9';

/** Godot `String::capitalize()` (camelCase / snake_case → "Title Case"). */
export function capitalize(text) {
  const chars = Array.from(text);
  let snake = '';
  let start = 0;
  for (let i = 1; i < chars.length; i++) {
    const prevUpper = isUpper(chars[i - 1]);
    const prevLower = isLower(chars[i - 1]);
    const prevDigit = isDigit(chars[i - 1]);
    const currUpper = isUpper(chars[i]);
    const currLower = isLower(chars[i]);
    const currDigit = isDigit(chars[i]);
    const nextLower = i + 1 < chars.length && isLower(chars[i + 1]);
    const condA = prevLower && currUpper;
    const condB = (prevUpper || prevDigit) && currUpper && nextLower;
    const condC = prevDigit && currLower && nextLower; // "2aa"
    const condD = (prevUpper || prevLower) && currDigit;
    if (condA || condB || condC || condD) {
      snake += chars.slice(start, i).join('') + '_';
      start = i;
    }
  }
  snake += chars.slice(start).join('');
  const words = toLower(snake).replaceAll('_', ' ').trim().split(' ');
  return words.filter((w) => w.length > 0).map((w) => toUpper(Array.from(w)[0]) + Array.from(w).slice(1).join('')).join(' ');
}

/** GDScript `strip_edges()` (whitespace = code points ≤ 32). */
export function stripEdges(text) {
  let a = 0;
  let b = text.length;
  while (a < b && text.charCodeAt(a) <= 32) a++;
  while (b > a && text.charCodeAt(b - 1) <= 32) b--;
  return text.slice(a, b);
}
