/**
 * ftw — the glyph rasterizer: FreeType 2.14.3 + HarfBuzz 14.2.0 (the sources and options of Godot
 * 4.7.2) compiled to WebAssembly by tools/build-ftw.mjs, driven the way TextServerAdvanced drives
 * them (native/ftw/ftw.c). Bitmaps are the engine's, bit for bit (test/glyphs.test.mjs).
 *
 *   const ft = await loadRasterizer();
 *   const face = ft.openFace(fontBytes, { variation: { wght: 600 } });
 *   const bitmap = ft.render(face, size26_6, outlinePixels, glyphIndex, xshift26_6);
 *   // → { width, rows, left, top, pixels }   (pixels: coverage bytes, row by row; a copy)
 *
 * The module's only imports are six WASI calls its C library references (environment, stderr, exit);
 * they are answered here: no environment, messages go to console.error, exit throws.
 */

/** TextServer.Hinting */
export const HINTING = Object.freeze({ NONE: 0, LIGHT: 1, NORMAL: 2 });

/** FontFile import defaults of the game's fonts (*.ttf.import). */
const FACE_DEFAULTS = Object.freeze({ hinting: HINTING.LIGHT, forceAutohinter: false, disableEmbeddedBitmaps: true, variation: {} });

const WASI_ERRNO_SUCCESS = 0;
const WASI_ERRNO_BADF = 8;
/** Byte offsets of the FtwGlyph record (native/ftw/ftw.c). */
const RESULT = Object.freeze({ error: 0, width: 4, rows: 8, left: 12, top: 16, pitch: 20, advanceH: 24, advanceV: 28, buffer: 32 });

const tagOf = (name) => (name.charCodeAt(0) << 24) | (name.charCodeAt(1) << 16) | (name.charCodeAt(2) << 8) | name.charCodeAt(3);

export class FreeTypeError extends Error {
  constructor(operation, code) {
    super(`FreeType: ${operation} failed (error ${code})`);
    this.name = 'FreeTypeError';
    this.code = code;
  }
}

export class Rasterizer {
  /** @param {WebAssembly.Instance} instance */
  constructor(instance) {
    this.exports = instance.exports;
    this.memory = instance.exports.memory;
    /** Font file bytes → pointer of their copy inside the module (one copy per file). */
    this.files = new Map();
    /** `${face}|${size}|${outline}` → size handle. */
    this.sizes = new Map();
    const error = this.exports.ftw_init();
    if (error) throw new FreeTypeError('FT_Init_FreeType', error);
    this.resultPointer = this.exports.ftw_result();
    const version = this.exports.ftw_version();
    this.version = `${version >> 16}.${(version >> 8) & 255}.${version & 255}`;
  }

  _view() {
    // The buffer is replaced whenever the memory grows: never keep a view across calls.
    return new DataView(this.memory.buffer);
  }

  _store(bytes) {
    const pointer = this.exports.ftw_malloc(bytes.length);
    if (!pointer) throw new FreeTypeError('malloc', 64);
    new Uint8Array(this.memory.buffer, pointer, bytes.length).set(bytes);
    return pointer;
  }

  /**
   * One face per font variation, as the engine keeps one FT_Face per FontVariation cache entry.
   * @param {Uint8Array} bytes the font file
   * @param {{hinting?: number, forceAutohinter?: boolean, disableEmbeddedBitmaps?: boolean, variation?: Record<string, number>}} options
   */
  openFace(bytes, options = {}) {
    const { hinting, forceAutohinter, disableEmbeddedBitmaps, variation } = { ...FACE_DEFAULTS, ...options };
    let data = this.files.get(bytes);
    if (data === undefined) {
      data = this._store(bytes);
      this.files.set(bytes, data);
    }
    const axes = Object.entries(variation);
    const tags = this.exports.ftw_malloc(Math.max(1, axes.length) * 4);
    const values = this.exports.ftw_malloc(Math.max(1, axes.length) * 8);
    const view = this._view();
    axes.forEach(([name, value], i) => {
      view.setUint32(tags + i * 4, tagOf(name), true);
      view.setFloat64(values + i * 8, value, true);
    });
    const handle = this.exports.ftw_face_open(data, bytes.length, hinting, forceAutohinter ? 1 : 0, disableEmbeddedBitmaps ? 1 : 0, tags, values, axes.length);
    this.exports.ftw_free(tags);
    this.exports.ftw_free(values);
    if (handle < 1) throw new FreeTypeError('FT_Open_Face', -handle);
    return handle;
  }

  /** The engine's cache entry for (font, Vector2i(size 26.6, outline px)). O(1) after the first call. */
  _size(face, size26, outline) {
    const key = `${face}|${size26}|${outline}`;
    let handle = this.sizes.get(key);
    if (handle === undefined) {
      handle = this.exports.ftw_size_open(face, size26, outline);
      if (handle < 1) throw new FreeTypeError('FT_Request_Size', -handle);
      this.sizes.set(key, handle);
    }
    return handle;
  }

  /** FT_Size_Metrics of a size: 26.6 values and 16.16 scales. */
  metrics(face, size26) {
    const handle = this._size(face, size26, 0);
    const out = this.exports.ftw_malloc(28);
    const error = this.exports.ftw_size_metrics(handle, out);
    const view = this._view();
    const read = (i) => view.getInt32(out + i * 4, true);
    const metrics = { ascender: read(0), descender: read(1), height: read(2), xScale: read(3), yScale: read(4), xPpem: read(5), yPpem: read(6) };
    this.exports.ftw_free(out);
    if (error) throw new FreeTypeError('size metrics', error);
    return metrics;
  }

  /**
   * One glyph bitmap. `xshift` is the sub-pixel shift in 26.6 (variant << 4 for quarter pixels,
   * variant << 5 for half pixels). Returns null for glyphs FreeType cannot load.
   * An empty glyph (a space) has width 0 and no pixels.
   */
  render(face, size26, outline, glyph, xshift = 0) {
    const error = this.exports.ftw_render(this._size(face, size26, outline), glyph, xshift);
    if (error) return null;
    const view = this._view();
    const at = this.resultPointer;
    const width = view.getInt32(at + RESULT.width, true);
    const rows = view.getInt32(at + RESULT.rows, true);
    const pitch = view.getInt32(at + RESULT.pitch, true);
    const buffer = view.getUint32(at + RESULT.buffer, true);
    const pixels = new Uint8Array(width * rows);
    if (width > 0 && rows > 0 && buffer !== 0) {
      const source = new Uint8Array(this.memory.buffer);
      // pitch may exceed width (and FreeType allows it to be negative for bottom-up bitmaps).
      for (let row = 0; row < rows; row++) {
        const from = buffer + (pitch >= 0 ? row : rows - 1 - row) * Math.abs(pitch);
        pixels.set(source.subarray(from, from + width), row * width);
      }
    }
    return {
      width,
      rows,
      left: view.getInt32(at + RESULT.left, true),
      top: view.getInt32(at + RESULT.top, true),
      advanceH: view.getInt32(at + RESULT.advanceH, true),
      advanceV: view.getInt32(at + RESULT.advanceV, true),
      pixels,
    };
  }

  charIndex(face, code) {
    return this.exports.ftw_char_index(face, code);
  }
}

/** The six WASI calls the module's C library references, answered without a host. */
function wasiImports(memoryOf) {
  const decoder = new TextDecoder();
  return {
    environ_sizes_get(countPointer, sizePointer) {
      const view = new DataView(memoryOf().buffer);
      view.setUint32(countPointer, 0, true);
      view.setUint32(sizePointer, 0, true);
      return WASI_ERRNO_SUCCESS;
    },
    environ_get: () => WASI_ERRNO_SUCCESS,
    fd_close: () => WASI_ERRNO_BADF,
    fd_seek: () => WASI_ERRNO_BADF,
    /** stdout / stderr of the C library (assertion messages): forwarded to the console. */
    fd_write(descriptor, vectors, vectorCount, writtenPointer) {
      const memory = memoryOf();
      const view = new DataView(memory.buffer);
      let text = '';
      let written = 0;
      for (let i = 0; i < vectorCount; i++) {
        const pointer = view.getUint32(vectors + i * 8, true);
        const length = view.getUint32(vectors + i * 8 + 4, true);
        text += decoder.decode(new Uint8Array(memory.buffer, pointer, length));
        written += length;
      }
      if (text.trim()) console.error(`ftw[${descriptor}]: ${text.trimEnd()}`);
      view.setUint32(writtenPointer, written, true);
      return WASI_ERRNO_SUCCESS;
    },
    proc_exit(code) {
      throw new Error(`ftw: the rasterizer aborted (exit ${code})`);
    },
  };
}

async function readBytes(source) {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  const url = new URL(source, import.meta.url);
  if (url.protocol === 'file:') {
    const { readFile } = await import(/* @vite-ignore */ 'node:fs/promises');
    return new Uint8Array(await readFile(url));
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`ftw.wasm: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

let shared = null;

/**
 * Loads the module once (idempotent). `source`: bytes, or a URL (default: ftw.wasm beside this file).
 * @returns {Promise<Rasterizer>}
 */
export function loadRasterizer(source = new URL('./ftw.wasm', import.meta.url)) {
  shared ??= (async () => {
    const bytes = await readBytes(source);
    let instance = null;
    const { instance: created } = await WebAssembly.instantiate(bytes, { wasi_snapshot_preview1: wasiImports(() => instance.exports.memory) });
    instance = created;
    instance.exports._initialize();
    return new Rasterizer(instance);
  })();
  return shared;
}
