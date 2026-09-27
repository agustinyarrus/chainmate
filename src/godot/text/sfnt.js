/**
 * Minimal OpenType reader — only the tables Godot's text server gets its numbers from through FreeType:
 * head (units per em), hhea (ascender / descender), hmtx (default advances), fvar (axes), avar
 * (segment maps) and HVAR (advance deltas of variable fonts: ItemVariationStore + DeltaSetIndexMap).
 *
 * Shaping itself (GSUB/GPOS) stays with HarfBuzz; this exists because FreeType computes base advances
 * with 16.16 fixed-point axis coordinates while HarfBuzz uses 2.14, and at wght 600 in Cinzel that
 * difference moves three glyphs by 1/64 px. Parsing is O(table size), done once per font file.
 */

const F2DOT14 = 1 / 16384;

/** Big-endian reader over one font file. */
class Reader {
  constructor(bytes) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  u8(offset) { return this.view.getUint8(offset); }
  u16(offset) { return this.view.getUint16(offset); }
  i16(offset) { return this.view.getInt16(offset); }
  u32(offset) { return this.view.getUint32(offset); }
  i32(offset) { return this.view.getInt32(offset); }
  i8(offset) { return this.view.getInt8(offset); }
  tag(offset) { return String.fromCharCode(this.u8(offset), this.u8(offset + 1), this.u8(offset + 2), this.u8(offset + 3)); }
}

export class SfntFont {
  /** @param {Uint8Array} bytes a TrueType-flavoured OpenType file */
  constructor(bytes) {
    this.bytes = bytes;
    const r = new Reader(bytes);
    this.r = r;
    this.tables = new Map();
    const count = r.u16(4);
    for (let i = 0; i < count; i++) {
      const at = 12 + i * 16;
      this.tables.set(r.tag(at), { offset: r.u32(at + 8), length: r.u32(at + 12) });
    }
    const head = this._table('head');
    this.headFlags = r.u16(head + 16);
    this.upem = r.u16(head + 18);
    const hhea = this._table('hhea');
    this.ascender = r.i16(hhea + 4);
    this.descender = r.i16(hhea + 6);
    this.lineGap = r.i16(hhea + 8);
    this.numberOfHMetrics = r.u16(hhea + 34);
    this.hmtx = this._table('hmtx');
    this.axes = this._readFvar();
    this.avar = this._readAvar();
    this.hvar = this._readHvar();
  }

  _table(tag) {
    const entry = this.tables.get(tag);
    if (!entry) throw new Error(`font has no '${tag}' table`);
    return entry.offset;
  }

  /** Default-instance advance (hmtx; glyphs past numberOfHMetrics repeat the last one). */
  defaultAdvance(gid) {
    const index = Math.min(gid, this.numberOfHMetrics - 1);
    return this.r.u16(this.hmtx + index * 4);
  }

  _readFvar() {
    if (!this.tables.has('fvar')) return [];
    const r = this.r;
    const at = this._table('fvar');
    const axesOffset = r.u16(at + 4);
    const count = r.u16(at + 8);
    const size = r.u16(at + 10);
    const axes = [];
    for (let i = 0; i < count; i++) {
      const a = at + axesOffset + i * size;
      // Fixed 16.16 values kept as integers (FreeType's FT_Fixed).
      axes.push({ tag: r.tag(a), minimum: r.i32(a + 4), def: r.i32(a + 8), maximum: r.i32(a + 12) });
    }
    return axes;
  }

  /** avar v1 segment maps, correspondence coordinates converted to 16.16 (F2Dot14 << 2). */
  _readAvar() {
    if (!this.tables.has('avar')) return null;
    const r = this.r;
    const at = this._table('avar');
    const axisCount = r.u16(at + 6);
    let p = at + 8;
    const maps = [];
    for (let i = 0; i < axisCount; i++) {
      const pairs = r.u16(p);
      p += 2;
      const map = [];
      for (let k = 0; k < pairs; k++) {
        map.push({ from: r.i16(p) * 4, to: r.i16(p + 2) * 4 });
        p += 4;
      }
      maps.push(map);
    }
    return maps;
  }

  _readHvar() {
    if (!this.tables.has('HVAR')) return null;
    const r = this.r;
    const at = this._table('HVAR');
    const storeOffset = r.u32(at + 4);
    const mapOffset = r.u32(at + 8);
    return {
      store: this._readItemVariationStore(at + storeOffset),
      advanceMap: mapOffset ? this._readDeltaSetIndexMap(at + mapOffset) : null,
    };
  }

  _readItemVariationStore(at) {
    const r = this.r;
    const regionListOffset = r.u32(at + 2);
    const dataCount = r.u16(at + 6);
    const regionList = at + regionListOffset;
    const axisCount = r.u16(regionList);
    const regionCount = r.u16(regionList + 2);
    const regions = [];
    for (let i = 0; i < regionCount; i++) {
      const axes = [];
      for (let j = 0; j < axisCount; j++) {
        const c = regionList + 4 + (i * axisCount + j) * 6;
        // F2Dot14 → 16.16, as FreeType stores them.
        axes.push({ start: r.i16(c) * 4, peak: r.i16(c + 2) * 4, end: r.i16(c + 4) * 4 });
      }
      regions.push(axes);
    }
    const data = [];
    for (let i = 0; i < dataCount; i++) data.push(this._readItemVariationData(at + r.u32(at + 8 + i * 4)));
    return { axisCount, regions, data };
  }

  _readItemVariationData(at) {
    const r = this.r;
    const itemCount = r.u16(at);
    const wordDeltaCount = r.u16(at + 2);
    const regionIndexCount = r.u16(at + 4);
    const longWords = (wordDeltaCount & 0x8000) !== 0;
    const wordCount = wordDeltaCount & 0x7fff;
    const regionIndexes = [];
    for (let i = 0; i < regionIndexCount; i++) regionIndexes.push(r.u16(at + 6 + i * 2));
    const rowsAt = at + 6 + regionIndexCount * 2;
    const wordSize = longWords ? 4 : 2;
    const shortSize = longWords ? 2 : 1;
    const rowSize = wordCount * wordSize + (regionIndexCount - wordCount) * shortSize;
    return {
      itemCount,
      regionIndexes,
      /** Deltas of one item (integers, font units). */
      row(item) {
        const deltas = new Array(regionIndexCount);
        let p = rowsAt + item * rowSize;
        for (let k = 0; k < regionIndexCount; k++) {
          if (k < wordCount) {
            deltas[k] = longWords ? r.i32(p) : r.i16(p);
            p += wordSize;
          } else {
            deltas[k] = longWords ? r.i16(p) : r.i8(p);
            p += shortSize;
          }
        }
        return deltas;
      },
    };
  }

  /** DeltaSetIndexMap formats 0/1 → function gid → {outer, inner}. */
  _readDeltaSetIndexMap(at) {
    const r = this.r;
    const format = r.u8(at);
    const entryFormat = r.u8(at + 1);
    const mapCount = format === 0 ? r.u16(at + 2) : r.u32(at + 2);
    const dataAt = at + (format === 0 ? 4 : 6);
    const entrySize = ((entryFormat & 0x30) >> 4) + 1;
    const innerBits = (entryFormat & 0x0f) + 1;
    return (gid) => {
      const index = Math.min(gid, mapCount - 1);
      let entry = 0;
      for (let b = 0; b < entrySize; b++) entry = entry * 256 + r.u8(dataAt + index * entrySize + b);
      return { outer: Math.floor(entry / 2 ** innerBits), inner: entry & ((1 << innerBits) - 1) };
    };
  }
}

export { F2DOT14 };
