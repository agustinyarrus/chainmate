/**
 * Test-side access to the oracle dumps produced by tools/oracle.mjs (answers given by the ORIGINAL
 * Godot build). Doubles travel as little-endian hex so comparisons are bit-exact.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function loadOracle(name) {
  const file = join(ROOT, '_oracle', `${name}.json`);
  if (!existsSync(file)) throw new Error(`oracle ${name} missing — run: node tools/oracle.mjs ${name}`);
  return JSON.parse(readFileSync(file, 'utf8')).entries;
}

/** All entries of a kind, in emission order. */
export const ofKind = (entries, kind) => entries.filter((e) => e.k === kind);

/** Hex (little-endian IEEE-754 double) → number. */
export function hexToDouble(hex) {
  const bytes = new Uint8Array(8);
  for (let i = 0; i < 8; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return new DataView(bytes.buffer).getFloat64(0, true);
}

/** number → the same hex encoding the probes use. */
export function doubleToHex(value) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, true);
  return Array.from(new Uint8Array(view.buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}
