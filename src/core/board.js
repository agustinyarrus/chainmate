/**
 * Board — port of scripts/core/board.gd.
 *
 * A 6×6 board: `pieces` keeps insertion order (it decides move-generation order, hence AI choices and
 * which of two equal moves wins), `_grid` is the O(1) cell → piece index, `tiles` the terrain states.
 * Pieces are plain dictionaries {id, kind, friendly, cell, level, upgrades, ward}, like the original.
 */
import { Vector2i } from '../godot/math.js';
import { GDict, count, duplicate } from '../godot/gdscript.js';
import { ChessRules } from './chess_rules.js';
import { Upgrades } from './upgrades.js';

/** GDScript `dict.is_empty()` without allocating (pieces and records are small plain objects). */
export function isEmpty(dict) {
  if (dict === null || dict === undefined) return true;
  for (const _ in dict) return false;
  return true;
}

export class Board {
  static SIZE = 6;
  static TILE_STATES = ['frozen', 'corrupted', 'enchanted'];

  constructor() {
    /** @type {Array<object>} */
    this.pieces = [];
    /** Vector2i → state */
    this.tiles = new GDict();
    this._grid = new Array(Board.SIZE * Board.SIZE).fill(null);
  }

  static in_bounds(cell) {
    return cell.x >= 0 && cell.y >= 0 && cell.x < Board.SIZE && cell.y < Board.SIZE;
  }

  /** Chebyshev distance (king steps). */
  static distance(a, b) {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  }

  static make_piece(id, kind, friendly, cell, level = 0, upgrades = []) {
    return {
      id,
      kind,
      friendly,
      cell,
      level,
      upgrades: upgrades.slice(),
      ward: count(upgrades, 'ward'),
    };
  }

  clone() {
    const copy = new Board();
    for (const piece of this.pieces) {
      const entry = { ...piece };
      entry.upgrades = piece.upgrades.slice();
      copy.add(entry);
    }
    copy.tiles = this.tiles.duplicate();
    return copy;
  }

  add(piece) {
    this.pieces.push(piece);
    this._grid[this._index(piece.cell)] = piece;
  }

  insert(piece, index) {
    this.pieces.splice(index, 0, piece);
    this._grid[this._index(piece.cell)] = piece;
  }

  index_of(id) {
    for (let i = 0; i < this.pieces.length; i++) if (this.pieces[i].id === id) return i;
    return -1;
  }

  remove(id) {
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const piece = this.pieces[i];
      if (piece.id === id) {
        this.pieces.splice(i, 1);
        if (this._grid[this._index(piece.cell)] === piece) this._grid[this._index(piece.cell)] = null;
        return piece;
      }
    }
    return {};
  }

  move(id, cell) {
    const piece = this.piece_by_id(id);
    if (this._grid[this._index(piece.cell)] === piece) this._grid[this._index(piece.cell)] = null;
    piece.cell = cell;
    this._grid[this._index(cell)] = piece;
  }

  piece_at(cell) {
    if (!Board.in_bounds(cell)) return {};
    const piece = this._grid[this._index(cell)];
    return piece !== null ? piece : {};
  }

  is_free(cell) {
    return Board.in_bounds(cell) && this._grid[this._index(cell)] === null;
  }

  piece_by_id(id) {
    for (const piece of this.pieces) if (piece.id === id) return piece;
    return {};
  }

  has_piece(id) {
    return !isEmpty(this.piece_by_id(id));
  }

  side(friendly) {
    const out = [];
    for (const piece of this.pieces) if (piece.friendly === friendly) out.push(piece);
    return out;
  }

  friendlies() {
    return this.side(true);
  }

  enemies() {
    return this.side(false);
  }

  king(friendly) {
    for (const piece of this.pieces) if (piece.friendly === friendly && piece.kind === 'king') return piece;
    return {};
  }

  tile(cell) {
    return String(this.tiles.get(cell, ''));
  }

  set_tile(cell, state) {
    if (state === '') this.tiles.erase(cell);
    else this.tiles.set(cell, state);
  }

  to_data() {
    const entries = [];
    for (const piece of this.pieces) {
      const entry = { ...piece };
      entry.cell = [piece.cell.x, piece.cell.y];
      entry.upgrades = piece.upgrades.slice();
      entries.push(entry);
    }
    const tileEntries = [];
    for (const [cell, state] of this.tiles.entries()) tileEntries.push([cell.x, cell.y, state]);
    return { pieces: entries, tiles: tileEntries };
  }

  static from_data(data) {
    if (data === null || typeof data !== 'object' || Array.isArray(data) || !('pieces' in data) || !('tiles' in data)) return null;
    if (!Array.isArray(data.pieces) || !Array.isArray(data.tiles)) return null;
    const board = new Board();
    for (const entry of data.pieces) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null;
      for (const key of ['id', 'kind', 'friendly', 'cell', 'level', 'upgrades', 'ward']) if (!(key in entry)) return null;
      const rawCell = entry.cell;
      if (!Array.isArray(rawCell) || rawCell.length !== 2 || !Array.isArray(entry.upgrades)) return null;
      const cell = new Vector2i(Math.trunc(rawCell[0]), Math.trunc(rawCell[1]));
      const kind = String(entry.kind);
      if (!Board.in_bounds(cell) || !board.is_free(cell) || !ChessRules.KINDS.includes(kind)) return null;
      const upgrades = [];
      for (const id of entry.upgrades) {
        if (!Upgrades.exists(String(id))) return null;
        upgrades.push(String(id));
      }
      const piece = Board.make_piece(String(entry.id), kind, Boolean(entry.friendly), cell, Math.trunc(entry.level), upgrades);
      piece.ward = Math.trunc(entry.ward);
      board.add(piece);
    }
    for (const entry of data.tiles) {
      if (!Array.isArray(entry) || entry.length !== 3) return null;
      const cell = new Vector2i(Math.trunc(entry[0]), Math.trunc(entry[1]));
      const state = String(entry[2]);
      if (!Board.in_bounds(cell) || !Board.TILE_STATES.includes(state)) return null;
      board.tiles.set(cell, state);
    }
    return board;
  }

  _index(cell) {
    return cell.y * Board.SIZE + cell.x;
  }
}

/** Deep copy of a piece dictionary (`piece.duplicate(true)`). */
export const clonePiece = (piece) => duplicate(piece, true);
