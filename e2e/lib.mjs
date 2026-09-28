/**
 * Shared pieces of the end-to-end tools (tour.mjs, stages.mjs): opening the game in the visible test
 * Chrome, saving the frames the page keeps as PNG data URLs, comparing images with the original's
 * and writing the local HTML report.
 */
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cpus } from 'node:os';
import { launchChrome } from '../tools/cdp.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/**
 * Where the game is served: the dev server by default; CHAINMATE_URL points the tools elsewhere
 * (`npm run preview` serves the production build on :4190 — a snapshot that edits cannot disturb).
 */
export const BASE = process.env.CHAINMATE_URL ?? 'http://127.0.0.1:5190/';
/** The on-page HUD, optional: CHAINMATE_HUD, or e2e/hud.local.mjs (not committed) re-exporting one. */
const HUD = process.env.CHAINMATE_HUD ?? join(ROOT, 'e2e', 'hud.local.mjs');
/** Chrome's debugging port; another one (CHAINMATE_CDP_PORT) lets two tours run side by side. */
const DEBUG_PORT = Number(process.env.CHAINMATE_CDP_PORT ?? 9340);
const BOOT_TIMEOUT_MS = 90000;

/**
 * Ends the tool once what it printed has left the process: a debugger socket or a pending timer
 * must never keep a finished tool alive (nor cut its last lines when the output is a pipe).
 */
export function exitWhenFlushed() {
  process.stdout.write('', () => process.exit(process.exitCode ?? 0));
}

/** `key=` would reach the game as `--key=`; bare flags must stay bare. */
export const bareFlags = (url) => url.href.replace(/=(?=&|$)/g, '');

/**
 * Opens `url` in the visible test Chrome on a first-run profile and waits for the game to run.
 * `beforeLoad`: a script evaluated in the page before its own (a probe that must see the game being
 * built); it applies to this load only.
 * `chrome`: launchChrome options for a dedicated instance (another port, muted audio, the real
 * autoplay policy).
 * Returns the page, the on-page HUD (null when the HUD module is not installed) and the browser.
 */
export async function openGame(url, { width = 1600, height = 900, title = 'Chainmate', beforeLoad = null, chrome: chromeOptions = {} } = {}) {
  const chrome = await launchChrome({ port: DEBUG_PORT, width, height, ...chromeOptions });
  const page = await chrome.page();
  await page.viewport(width, height);
  await page.clearStorage(new URL(BASE).origin);
  const injected = beforeLoad ? await page.send('Page.addScriptToEvaluateOnNewDocument', { source: beforeLoad }) : null;
  await page.goto(url);
  // Registered scripts would run on every later load of this tab: the probe is for this one.
  if (injected) {
    await page.waitFor('document.readyState !== "loading"', { timeout: BOOT_TIMEOUT_MS });
    await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected.identifier });
  }
  await page.waitFor(`window.chainmate && (window.chainmate.state === 'running' || window.chainmate.state === 'failed')`, { timeout: BOOT_TIMEOUT_MS });
  if ((await page.eval('window.chainmate.state')) === 'failed') throw new Error(`the game did not start: ${await page.eval('JSON.stringify(window.chainmate.errors)')}`);
  const { crearHud } = existsSync(HUD) ? await import(pathToFileURL(HUD).href) : { crearHud: null };
  const hud = crearHud ? crearHud({ evaluar: (js) => page.eval(js), titulo: title, rapido: true, consola: false }) : null;
  return { page, hud, chrome };
}

/**
 * Takes shot number `index` out of `window.chainmate.<store>.shots` (freeing it in the page) and
 * writes it as `<folder>/<name>.png`. Returns the shot's description without the image.
 */
export async function pullShot(page, store, index, folder) {
  const shot = JSON.parse(await page.eval(`(() => { const s = window.chainmate.${store}.shots[${index}]; const out = JSON.stringify(s); s.url = null; return out; })()`));
  const file = join(folder, `${shot.name}.png`);
  writeFileSync(file, Buffer.from(shot.url.slice(shot.url.indexOf(',') + 1), 'base64'));
  delete shot.url;
  return { ...shot, file };
}

/** Anything the browser or three.js says about WebGL. */
const GL_MESSAGE = /WebGL|GL_INVALID|GL_OUT_OF_MEMORY|CONTEXT_LOST/i;
/** What makes it a failure: a refused call, a lost context, a program that did not build. */
const GL_FAILURE = /INVALID_(OPERATION|VALUE|ENUM|FRAMEBUFFER_OPERATION|INDEX)|OUT_OF_MEMORY|CONTEXT_LOST|Shader Error|VALIDATE_STATUS false|\berror\b/i;
/** A program that built with remarks from the driver's compiler (three.js logs them as warnings). */
const GL_COMPILER_NOTE = /Program Info Log:[^]*\bwarning\b/i;

/**
 * What the GPU said while the page ran, distinct messages in order: `errors` are refused draws (an
 * image with something missing) and programs that did not build; `warnings` are remarks of the
 * driver's shader compiler on programs that did build (worth reading, never a failure).
 * @returns {{errors: string[], warnings: string[]}}
 */
export function webglProblems(page) {
  const messages = [...new Set(page.console.filter((entry) => GL_MESSAGE.test(entry.text)).map((entry) => entry.text.trim()))];
  const isWarning = (text) => GL_COMPILER_NOTE.test(text) && !GL_FAILURE.test(text);
  return { errors: messages.filter((text) => !isWarning(text)), warnings: messages.filter(isWarning) };
}

/** Pixel statistics of one pair (tools/compare.py --json). Resolves, never rejects. */
export function compare(original, port, out, extra = []) {
  return new Promise((done) => {
    const child = spawn('python', [join(ROOT, 'tools', 'compare.py'), original, port, '--out', out, '--json', ...extra], { env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => {
      if (code !== 0) done({ error: (stderr || stdout).trim().split('\n').pop() });
      else done(JSON.parse(stdout.trim().split('\n').pop()));
    });
  });
}

/** Runs `job` over `items` with at most `limit` at a time, keeping the order of the results. O(n). */
export async function pool(items, job, limit = Math.max(2, Math.min(6, cpus().length - 2))) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await job(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const VERDICT_COLOR = { identical: '#9ece6a', match: '#9ece6a', close: '#e0af68', different: '#f7768e', missing: '#565f89' };

/**
 * Writes `<folder>/report.html`: one card per row with original, port and amplified difference.
 * @param {{name: string, verdict: string, stats?: object, note?: string, original?: string, port: string, diff?: string}[]} rows
 * @param {string} [extraHtml] trusted HTML placed above the cards (tables built by the caller)
 */
export function report(folder, title, rows, log, extraHtml = '') {
  const cards = rows.map((row) => `
    <section>
      <header><b>${esc(row.name)}</b><span style="color:${VERDICT_COLOR[row.verdict] ?? '#c0caf5'}">${esc(row.verdict)}</span>
        <i>${row.stats ? `mean ${row.stats.mean.toFixed(3)} · off ${row.stats.share.toFixed(3)} % · max ${row.stats.max}` : esc(row.note ?? '')}</i></header>
      <div class="pair">
        ${row.original ? `<figure><img loading="lazy" src="${esc(row.original)}"><figcaption>original</figcaption></figure>` : ''}
        <figure><img loading="lazy" src="${esc(row.port)}"><figcaption>port</figcaption></figure>
        ${row.diff ? `<figure><img loading="lazy" src="${esc(row.diff)}"><figcaption>original · port · difference ×6</figcaption></figure>` : ''}
      </div>
    </section>`).join('\n');
  const matched = rows.filter((r) => r.verdict === 'identical' || r.verdict === 'match').length;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
  body{margin:0;background:#000;color:#c0caf5;font:200 14px/1.5 'Cascadia Code','Cascadia Mono',Consolas,monospace;padding:28px 36px}
  h1{font-weight:200;color:#bb9af7;letter-spacing:.06em;margin:0 0 4px}
  h2{font-weight:200;color:#7aa2f7;letter-spacing:.04em;margin:26px 0 8px;font-size:16px}
  p.sub{color:#565f89;margin:0 0 26px}
  section{border:1px solid #1f2335;border-radius:12px;margin:0 0 22px;padding:14px 18px;background:#05060a}
  header{display:flex;gap:18px;align-items:baseline;margin-bottom:10px}
  header b{color:#7aa2f7;font-weight:400} header i{color:#565f89;font-style:normal;margin-left:auto}
  .pair{display:grid;grid-template-columns:1fr 1fr;gap:12px} .pair figure:nth-child(3){grid-column:1 / span 2}
  figure{margin:0} img{width:100%;display:block;border-radius:6px;background:#0a0b10} figcaption{color:#565f89;font-size:12px;margin-top:4px}
  table{border-collapse:collapse;margin:0 0 22px} td,th{padding:3px 14px 3px 0;text-align:right;font-weight:200} th{color:#565f89} td:first-child,th:first-child{text-align:left;color:#7aa2f7}
  pre{color:#9aa5ce;background:#05060a;border:1px solid #1f2335;border-radius:12px;padding:14px 18px;white-space:pre-wrap}
  </style></head><body><h1>${esc(title)}</h1><p class="sub">${rows.length} images · ${matched} match · generated ${new Date().toISOString().slice(0, 19).replace('T', ' ')}</p>
  ${extraHtml}${cards}<pre>${esc(log.join('\n'))}</pre></body></html>`;
  const file = join(folder, 'report.html');
  writeFileSync(file, html);
  return file;
}
