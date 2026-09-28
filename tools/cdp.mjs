/**
 * Minimal Chrome DevTools Protocol client for this repo's browser checks — no dependencies (Node's
 * built-in WebSocket). Opens a VISIBLE Chrome on a dedicated profile, attaches to its page, and
 * exposes eval / screenshot / mouse / keys / viewport emulation.
 *
 *   const chrome = await launchChrome({ port: 9340, width: 1600, height: 900 });
 *   const page = await chrome.page();
 *   await page.goto('http://127.0.0.1:5190/');
 *   await page.shot('shots/menu.png');
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = join(process.env.ProgramFiles ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe');
/** Test profiles live inside the project (git-ignored), never in the system's temporary folder. */
const PROFILES = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.cache');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Chrome's window frame at scale 1 (tabs, address bar, borders): the viewport needs this much more. */
const FRAME = { width: 16, height: 95 };

async function alive(port) {
  try {
    return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok;
  } catch {
    return false;
  }
}

class Page {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.exceptions = [];
    this.console = [];
    ws.addEventListener('message', (message) => {
      const m = JSON.parse(message.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject, timer } = this.pending.get(m.id);
        clearTimeout(timer);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(`${JSON.stringify(m.error)}`));
        else resolve(m.result);
      } else if (m.method === 'Runtime.exceptionThrown') {
        this.exceptions.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
      } else if (m.method === 'Runtime.consoleAPICalled') {
        this.console.push({ type: m.params.type, text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' ') });
      } else if (m.method === 'Log.entryAdded') {
        // What the browser itself reports (WebGL errors, failed loads, interventions): not console.* calls.
        const { level, text, source } = m.params.entry;
        this.console.push({ type: level, text, source, browser: true });
      }
    });
  }

  send(method, params = {}, timeoutMs = 120000) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      // The timer is cleared on reply, so finished scripts exit instead of idling until it fires.
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }

  async goto(url) {
    await this.send('Page.navigate', { url });
  }

  /** Forgets what an origin stored (localStorage…): a capture starts from a first-run profile. */
  async clearStorage(origin) {
    await this.send('Storage.clearDataForOrigin', { origin, storageTypes: 'local_storage,indexeddb,cache_storage' });
  }

  async waitFor(expression, { timeout = 60000, label = expression } = {}) {
    const until = Date.now() + timeout;
    let delay = 100;
    while (Date.now() < until) {
      try {
        if (await this.eval(`!!(${expression})`)) return true;
      } catch {
        // page still navigating
      }
      await sleep(delay);
      delay = Math.min(500, delay + 50);
    }
    throw new Error(`timeout waiting for ${label}`);
  }

  async viewport(width, height, scale = 1) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
    const { windowId } = await this.send('Browser.getWindowForTarget');
    await this.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    await this.send('Browser.setWindowBounds', { windowId, bounds: { width: width + FRAME.width, height: height + FRAME.height } });
  }

  async shot(path) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.from(r.data, 'base64'));
    return path;
  }

  async mouse(type, x, y, button = 'none', clickCount = 0) {
    await this.send('Input.dispatchMouseEvent', { type, x, y, button, clickCount });
  }

  async click(x, y, button = 'left') {
    await this.mouse('mouseMoved', x, y);
    await sleep(60);
    await this.mouse('mousePressed', x, y, button, 1);
    await sleep(90);
    await this.mouse('mouseReleased', x, y, button, 1);
  }

  async key(code, { key = code, text } = {}) {
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key, text });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // already closed
    }
  }
}

/**
 * Opens (or reuses) the test Chrome on `port`. `muteAudio`: the audio graph still renders — an
 * AnalyserNode measures it — but nothing reaches the speakers (the desktop's user hears nothing).
 * `autoplay`: false keeps Chrome's real policy (sound only after a user activation).
 */
export async function launchChrome({ port = 9340, width = 1600, height = 900, x = 20, y = 20, profile = join(PROFILES, `chrome-${port}`), muteAudio = false, autoplay = true } = {}) {
  if (!(await alive(port))) {
    spawn(CHROME, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run', '--no-default-browser-check', '--disable-features=Translate',
      // A covered or off-screen window must keep rendering and receiving synthetic input.
      '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
      ...(autoplay ? ['--autoplay-policy=no-user-gesture-required'] : []),
      ...(muteAudio ? ['--mute-audio'] : []),
      `--window-size=${width + FRAME.width},${height + FRAME.height}`, `--window-position=${x},${y}`, '--force-device-scale-factor=1',
      'about:blank',
    ], { detached: true, stdio: 'ignore' }).unref();
    for (let i = 0; i < 80 && !(await alive(port)); i++) await sleep(250);
    if (!(await alive(port))) throw new Error(`Chrome did not open its debug port ${port}`);
  }
  return {
    port,
    async page() {
      let target = null;
      for (let i = 0; i < 40 && !target; i++) {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (!target) await sleep(250);
      }
      if (!target) throw new Error('no page target');
      const ws = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', reject, { once: true });
      });
      const page = new Page(ws);
      await page.send('Page.enable');
      await page.send('Runtime.enable');
      await page.send('Log.enable');
      return page;
    },
    async close() {
      try {
        const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
        const ws = new WebSocket(webSocketDebuggerUrl);
        await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
        ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
        await sleep(500);
      } catch {
        // already gone
      }
    },
  };
}

export { sleep };
