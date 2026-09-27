#!/usr/bin/env node
/**
 * Oracle runner — executes a GDScript probe INSIDE the original Godot build and stores its answers.
 *
 *   node tools/oracle.mjs primitives            → runs _oracle/probe_primitives.gd → _oracle/primitives.json
 *   node tools/oracle.mjs runs --timeout 600
 *   node tools/oracle.mjs --rebuild             → re-patches Chainmate.exe into _oracle/ChainmateOracle.exe
 *
 * How it works: `ChainmateOracle.exe` is the shipped game with one change, made by GDRE Tools' --pck-patch:
 * the `Settings` autoload is the recovered text source plus a hook that, given `-- --oracle=<file.gd>`,
 * loads that probe, calls `run(host)` and quits. Probes print `ORACLE {json}` lines; this tool collects
 * them. The port's tests then compare their own output against these files, bit for bit.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { card, paint, spinner } from './term.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ORACLE_DIR = join(ROOT, '_oracle');
const PATCHED_EXE = join(ORACLE_DIR, 'ChainmateOracle.exe');
const ORIGINAL_EXE = join(process.env.USERPROFILE ?? '', 'Downloads', 'Chainmate.exe');
const GDRE = join(process.env.USERPROFILE ?? '', 'Box', '_tools', 'gdre', 'v2.7.0-beta.2', 'gdre_tools.exe');
const DEFAULT_TIMEOUT_S = 180;

const slash = (p) => p.replaceAll('\\', '/');

function parseArgs(argv) {
  const options = { probes: [], timeout: DEFAULT_TIMEOUT_S, rebuild: false, windowed: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--timeout') options.timeout = Number(argv[++i]);
    else if (arg === '--rebuild') options.rebuild = true;
    else if (arg === '--windowed') options.windowed = true;
    else options.probes.push(arg);
  }
  return options;
}

/** Spawns a process, streams stdout into memory, resolves with {code, stdout, stderr}. */
function run(file, args, timeoutS, onLine) {
  return new Promise((resolvePromise) => {
    const child = spawn(file, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    let pending = '';
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stdout += text;
      pending += text;
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        onLine?.(pending.slice(0, newline).trimEnd());
        pending = pending.slice(newline + 1);
      }
    });
    // Always drain stderr: a full pipe would block the child (lesson from carrona's build tools).
    child.stderr.on('data', (chunk) => (stderr += chunk.toString('utf8')));
    const timer = setTimeout(() => child.kill(), timeoutS * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout, stderr });
    });
  });
}

async function rebuildPatchedExe() {
  const patchedSettings = join(ORACLE_DIR, 'patch', 'settings.gd');
  if (!existsSync(patchedSettings)) throw new Error(`missing ${patchedSettings}`);
  const args = [
    '--headless',
    `--pck-patch=${slash(ORIGINAL_EXE)}`,
    `--patch-file=${slash(patchedSettings)}=res://scripts/autoload/settings.gd`,
    '--exclude=res://scripts/autoload/settings.gd.remap',
    '--exclude=res://scripts/autoload/settings.gdc',
    `--embed=${slash(ORIGINAL_EXE)}`,
    `--output=${slash(PATCHED_EXE)}`,
  ];
  const result = await run(GDRE, args, 300);
  if (!existsSync(PATCHED_EXE)) throw new Error(`GDRE did not produce the patched build:\n${result.stdout.slice(-2000)}`);
}

async function runProbe(name, options) {
  const probe = join(ORACLE_DIR, `probe_${name}.gd`);
  if (!existsSync(probe)) throw new Error(`no probe ${probe}`);
  const entries = [];
  const spin = spinner(`probe ${name}`);
  const started = Date.now();
  const args = options.windowed ? ['--position', '2600,60', '--audio-driver', 'Dummy'] : ['--headless'];
  const result = await run(PATCHED_EXE, [...args, '--', `--oracle=${slash(probe)}`], options.timeout, (line) => {
    if (line.startsWith('ORACLE ')) {
      entries.push(JSON.parse(line.slice(7)));
      spin.tick(`${entries.length} answers`);
    }
  });
  spin.stop();
  const done = result.stdout.includes('ORACLE_DONE');
  const errors = result.stdout.split('\n').filter((l) => l.startsWith('ORACLE_ERROR') || l.includes('SCRIPT ERROR'));
  const out = join(ORACLE_DIR, `${name}.json`);
  writeFileSync(out, JSON.stringify({ probe: name, generated: new Date().toISOString(), entries }, null, 1));
  return { name, done, count: entries.length, seconds: (Date.now() - started) / 1000, out, errors: errors.concat(result.stderr ? [result.stderr.slice(0, 400)] : []) };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  mkdirSync(ORACLE_DIR, { recursive: true });
  if (options.rebuild || !existsSync(PATCHED_EXE) || statSync(PATCHED_EXE).mtimeMs < statSync(join(ORACLE_DIR, 'patch', 'settings.gd')).mtimeMs) {
    const spin = spinner('patching Chainmate.exe with the oracle hook');
    await rebuildPatchedExe();
    spin.stop();
  }
  const rows = [];
  for (const name of options.probes) rows.push(await runProbe(name, options));
  card('oracle', rows.map((r) => [
    r.done ? paint.green('✓') : paint.red('✗'),
    paint.blue(r.name.padEnd(12)),
    `${String(r.count).padStart(6)} answers`,
    `${r.seconds.toFixed(1).padStart(6)} s`,
    paint.dim(r.out.replace(ROOT, '.')),
    r.errors.length ? paint.red(r.errors.join(' | ').slice(0, 160)) : '',
  ]));
  if (rows.some((r) => !r.done)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(paint.red(error.stack ?? String(error)));
  process.exitCode = 1;
});
