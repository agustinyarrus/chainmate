/**
 * Containers — Godot 4's Container family with the engine's own arithmetic:
 *   BoxContainer   integer stretch distribution with carried fractional error, alignment offsets;
 *   MarginContainer, CenterContainer (floor-centred), PanelContainer (stylebox margins),
 *   GridContainer (per-column/row expansion), and fit_child_in_rect (size flags, floor-centred shrink,
 *   rotation and scale reset).
 * Sorting is deferred (queue_sort → once, at the end of the frame) like the engine's MessageQueue.
 */
import { SceneTree } from '../scene.js';
import { Signal } from '../signal.js';
import { Control, SIZE, MOUSE_FILTER } from './control.js';

export const ALIGNMENT = Object.freeze({ BEGIN: 0, CENTER: 1, END: 2 });

export class Container extends Control {
  static themeType = 'Container';

  constructor(name = '') {
    super(name);
    this.mouse_filter = MOUSE_FILTER.PASS;
    this.sort_children = new Signal();
    this.pre_sort_children = new Signal();
    this._sortPending = false;
    this._childListeners = new Map();
  }

  _childAdded(child) {
    super._childAdded?.(child);
    if (!(child instanceof Control)) return;
    const onMin = () => {
      this.update_minimum_size();
      this.queue_sort();
    };
    const onFlags = () => this.queue_sort();
    const onVisibility = () => {
      this.update_minimum_size();
      this.queue_sort();
    };
    child.minimum_size_changed.connect(onMin);
    child.size_flags_changed.connect(onFlags);
    child.visibility_changed.connect(onVisibility);
    this._childListeners.set(child, { onMin, onFlags, onVisibility });
    this.update_minimum_size();
    this.queue_sort();
  }

  _childRemoved(child) {
    super._childRemoved?.(child);
    const listeners = this._childListeners.get(child);
    if (listeners) {
      child.minimum_size_changed.disconnect(listeners.onMin);
      child.size_flags_changed.disconnect(listeners.onFlags);
      child.visibility_changed.disconnect(listeners.onVisibility);
      this._childListeners.delete(child);
    }
    this.update_minimum_size();
    this.queue_sort();
  }

  _childMoved() {
    this.update_minimum_size();
    this.queue_sort();
  }

  _enter_tree() {
    super._enter_tree();
    this.queue_sort();
  }

  /** Container's NOTIFICATION_VISIBILITY_CHANGED: a container that becomes visible sorts again. */
  _visibility_changed() {
    super._visibility_changed();
    if (this.is_visible_in_tree()) this.queue_sort();
  }

  _resized() {
    this.queue_sort();
  }

  _theme_changed() {
    this.update_minimum_size();
    this.queue_sort();
  }

  queue_sort() {
    if (!this._inside || this._sortPending) return;
    this._sortPending = true;
    SceneTree.current?.callDeferred(() => this._sortChildren());
  }

  _sortChildren() {
    this._sortPending = false;
    if (!this._inside || this._freed) return;
    this.pre_sort_children.emit();
    this._sort();
    this.sort_children.emit();
  }

  /** NOTIFICATION_SORT_CHILDREN for subclasses. */
  _sort() {}

  /** Container::as_sortable_control: a visible (in tree), non-top-level child Control. */
  sortable(child, visibleOnly = true) {
    if (!(child instanceof Control) || child._queued || child._freed) return null;
    if (visibleOnly && !child.visible) return null;
    return child;
  }

  fit_child_in_rect(child, rect) {
    const min = child.get_combined_minimum_size();
    const r = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    const h = child.size_flags_horizontal;
    const v = child.size_flags_vertical;
    if (!(h & SIZE.FILL)) {
      r.w = min.x;
      if (h & SIZE.SHRINK_END) r.x += rect.w - min.x;
      else if (h & SIZE.SHRINK_CENTER) r.x += Math.floor((rect.w - min.x) / 2);
    }
    if (!(v & SIZE.FILL)) {
      r.h = min.y;
      if (v & SIZE.SHRINK_END) r.y += rect.h - min.y;
      else if (v & SIZE.SHRINK_CENTER) r.y += Math.floor((rect.h - min.y) / 2);
    }
    child.set_rect(r);
    child.rotation = 0;
    child.scale = { x: 1, y: 1 };
  }
}

/** Size2i(v): truncation toward zero, as the engine's integer vectors. */
const trunc = (v) => ({ x: Math.trunc(v.x), y: Math.trunc(v.y) });

export class BoxContainer extends Container {
  static themeType = 'BoxContainer';

  constructor(vertical = false, name = '') {
    super(name);
    this.vertical = vertical;
    this._alignment = ALIGNMENT.BEGIN;
  }

  get alignment() {
    return this._alignment;
  }
  set alignment(a) {
    this._alignment = a;
    this.queue_sort();
  }

  get_minimum_size() {
    const minimum = { x: 0, y: 0 };
    const separation = this.get_theme_constant('separation');
    let first = true;
    for (const child of this.children) {
      const c = this.sortable(child);
      if (!c) continue;
      const size = trunc(c.get_combined_minimum_size());
      if (this.vertical) {
        if (size.x > minimum.x) minimum.x = size.x;
        minimum.y += size.y + (first ? 0 : separation);
      } else {
        if (size.y > minimum.y) minimum.y = size.y;
        minimum.x += size.x + (first ? 0 : separation);
      }
      first = false;
    }
    return minimum;
  }

  /** BoxContainer::_resort */
  _sort() {
    const newSize = trunc(this.size);
    const separation = this.get_theme_constant('separation');
    const items = [];
    let stretchMin = 0;
    let stretchAvail = 0;
    let ratioTotal = 0;
    for (const child of this.children) {
      const c = this.sortable(child);
      if (!c || !c.is_visible_in_tree()) continue;
      const size = trunc(c.get_combined_minimum_size());
      const min = this.vertical ? size.y : size.x;
      const stretch = Boolean((this.vertical ? c.size_flags_vertical : c.size_flags_horizontal) & SIZE.EXPAND);
      stretchMin += min;
      if (stretch) {
        stretchAvail += min;
        ratioTotal += c.size_flags_stretch_ratio;
      }
      items.push({ c, min, willStretch: stretch, finalSize: min });
    }
    if (items.length === 0) return;
    const stretchMax = (this.vertical ? newSize.y : newSize.x) - (items.length - 1) * separation;
    let stretchDiff = stretchMax - stretchMin;
    if (stretchDiff < 0) stretchDiff = 0;
    stretchAvail += stretchDiff;
    let hasStretched = false;
    while (ratioTotal > 0) {
      hasStretched = true;
      let refitOk = true;
      let error = 0;
      for (const item of items) {
        if (!item.willStretch) continue;
        const finalPixel = Math.fround((stretchAvail * item.c.size_flags_stretch_ratio) / ratioTotal);
        error = Math.fround(error + (finalPixel - Math.trunc(finalPixel)));
        if (finalPixel < item.min) {
          item.willStretch = false;
          ratioTotal -= item.c.size_flags_stretch_ratio;
          refitOk = false;
          stretchAvail -= item.min;
          item.finalSize = item.min;
          break;
        }
        item.finalSize = Math.trunc(finalPixel);
        if (error >= 1) {
          item.finalSize += 1;
          error -= 1;
        }
      }
      if (refitOk) break;
    }
    let ofs = 0;
    if (!hasStretched) {
      if (this._alignment === ALIGNMENT.CENTER) ofs = Math.trunc(stretchDiff / 2);
      else if (this._alignment === ALIGNMENT.END) ofs = stretchDiff;
    }
    items.forEach((item, idx) => {
      if (idx > 0) ofs += separation;
      const from = ofs;
      let to = ofs + item.finalSize;
      if (item.willStretch && idx === items.length - 1) to = this.vertical ? newSize.y : newSize.x;
      const size = to - from;
      const rect = this.vertical ? { x: 0, y: from, w: newSize.x, h: size } : { x: from, y: 0, w: size, h: newSize.y };
      this.fit_child_in_rect(item.c, rect);
      ofs = to;
    });
  }
}

export class HBoxContainer extends BoxContainer {
  static themeType = 'HBoxContainer';
  constructor(name = '') {
    super(false, name);
  }
}

export class VBoxContainer extends BoxContainer {
  static themeType = 'VBoxContainer';
  constructor(name = '') {
    super(true, name);
  }
}

export class MarginContainer extends Container {
  static themeType = 'MarginContainer';

  _margins() {
    return [this.get_theme_constant('margin_left'), this.get_theme_constant('margin_top'), this.get_theme_constant('margin_right'), this.get_theme_constant('margin_bottom')];
  }

  get_minimum_size() {
    const [l, t, r, b] = this._margins();
    const max = { x: 0, y: 0 };
    for (const child of this.children) {
      const c = this.sortable(child);
      if (!c) continue;
      const s = c.get_combined_minimum_size();
      if (s.x > max.x) max.x = s.x;
      if (s.y > max.y) max.y = s.y;
    }
    return { x: max.x + l + r, y: max.y + t + b };
  }

  _sort() {
    const [l, t, r, b] = this._margins();
    const size = this.size;
    for (const child of this.children) {
      const c = this.sortable(child);
      if (!c) continue;
      this.fit_child_in_rect(c, { x: l, y: t, w: size.x - r - l, h: size.y - b - t });
    }
  }
}

export class CenterContainer extends Container {
  static themeType = 'CenterContainer';

  constructor(name = '') {
    super(name);
    this.use_top_left = false;
  }

  get_minimum_size() {
    const max = { x: 0, y: 0 };
    for (const child of this.children) {
      const c = this.sortable(child);
      if (!c) continue;
      const s = c.get_combined_minimum_size();
      max.x = Math.max(max.x, s.x);
      max.y = Math.max(max.y, s.y);
    }
    return max;
  }

  _sort() {
    const size = this.size;
    for (const child of this.children) {
      const c = this.sortable(child);
      if (!c) continue;
      const min = c.get_combined_minimum_size();
      const ofs = this.use_top_left ? { x: -min.x / 2, y: -min.y / 2 } : { x: Math.floor((size.x - min.x) / 2), y: Math.floor((size.y - min.y) / 2) };
      this.fit_child_in_rect(c, { x: ofs.x, y: ofs.y, w: min.x, h: min.y });
    }
  }
}

export class PanelContainer extends Container {
  static themeType = 'PanelContainer';

  constructor(name = '') {
    super(name);
    // "Has visible stylebox, so stop by default."
    this.mouse_filter = MOUSE_FILTER.STOP;
  }

  _style() {
    return this.get_theme_stylebox('panel');
  }

  get_minimum_size() {
    const max = { x: 0, y: 0 };
    for (const child of this.children) {
      const c = this.sortable(child);
      if (!c) continue;
      const s = c.get_combined_minimum_size();
      max.x = Math.max(max.x, s.x);
      max.y = Math.max(max.y, s.y);
    }
    const style = this._style();
    if (style) {
      const m = style.get_minimum_size();
      max.x += m.x;
      max.y += m.y;
    }
    return max;
  }

  _sort() {
    const size = this.size;
    const ofs = { x: 0, y: 0 };
    const style = this._style();
    if (style) {
      const m = style.get_minimum_size();
      size.x -= m.x;
      size.y -= m.y;
      const o = style.get_offset();
      ofs.x += o.x;
      ofs.y += o.y;
    }
    for (const child of this.children) {
      const c = this.sortable(child);
      if (!c) continue;
      this.fit_child_in_rect(c, { x: ofs.x, y: ofs.y, w: size.x, h: size.y });
    }
  }

  _draw_self() {
    const style = this._style();
    if (style) this.draw_style_box(style, { x: 0, y: 0, w: this.size.x, h: this.size.y });
  }
}

export class GridContainer extends Container {
  static themeType = 'GridContainer';

  constructor(name = '') {
    super(name);
    this._columns = 1;
  }

  get columns() {
    return this._columns;
  }
  set columns(n) {
    this._columns = Math.max(1, n);
    this.update_minimum_size();
    this.queue_sort();
  }

  _cells() {
    return this.children.map((child) => this.sortable(child)).filter(Boolean);
  }

  get_minimum_size() {
    const colMin = new Map();
    const rowMin = new Map();
    const hSep = this.get_theme_constant('h_separation');
    const vSep = this.get_theme_constant('v_separation');
    let maxRow = 0;
    let maxCol = 0;
    this._cells().forEach((c, idx) => {
      const row = Math.trunc(idx / this._columns);
      const col = idx % this._columns;
      const ms = c.get_combined_minimum_size();
      colMin.set(col, Math.max(colMin.get(col) ?? 0, ms.x));
      rowMin.set(row, Math.max(rowMin.get(row) ?? 0, ms.y));
      maxCol = Math.max(col, maxCol);
      maxRow = Math.max(row, maxRow);
    });
    const ms = { x: 0, y: 0 };
    for (const v of colMin.values()) ms.x += v;
    for (const v of rowMin.values()) ms.y += v;
    ms.y += vSep * maxRow;
    ms.x += hSep * maxCol;
    return ms;
  }

  /** GridContainer::_notification(NOTIFICATION_SORT_CHILDREN) */
  _sort() {
    const colMin = new Map();
    const rowMin = new Map();
    const colExpanded = new Set();
    const rowExpanded = new Set();
    const hSep = this.get_theme_constant('h_separation');
    const vSep = this.get_theme_constant('v_separation');
    const cells = this._cells();
    let maxCol = Math.min(cells.length, this._columns);
    let maxRow = Math.ceil(cells.length / this._columns);
    cells.forEach((c, idx) => {
      const row = Math.trunc(idx / this._columns);
      const col = idx % this._columns;
      const ms = c.get_combined_minimum_size();
      colMin.set(col, Math.max(colMin.get(col) ?? 0, ms.x));
      rowMin.set(row, Math.max(rowMin.get(row) ?? 0, ms.y));
      if (c.size_flags_horizontal & SIZE.EXPAND) colExpanded.add(col);
      if (c.size_flags_vertical & SIZE.EXPAND) rowExpanded.add(row);
    });
    const size = this.size;
    let remaining = { x: size.x - hSep * (maxCol - 1), y: size.y - vSep * (maxRow - 1) };
    for (const [col, w] of colMin) if (!colExpanded.has(col)) remaining.x -= w;
    for (const [row, h] of rowMin) if (!rowExpanded.has(row)) remaining.y -= h;
    // Columns/rows whose minimum exceeds the even share stop expanding (iterate until stable).
    let changed = true;
    while (changed && colExpanded.size) {
      changed = false;
      const share = remaining.x / colExpanded.size;
      for (const col of [...colExpanded]) {
        if ((colMin.get(col) ?? 0) > share) {
          colExpanded.delete(col);
          remaining.x -= colMin.get(col);
          changed = true;
        }
      }
    }
    changed = true;
    while (changed && rowExpanded.size) {
      changed = false;
      const share = remaining.y / rowExpanded.size;
      for (const row of [...rowExpanded]) {
        if ((rowMin.get(row) ?? 0) > share) {
          rowExpanded.delete(row);
          remaining.y -= rowMin.get(row);
          changed = true;
        }
      }
    }
    const colExpand = colExpanded.size ? Math.trunc(remaining.x / colExpanded.size) : 0;
    const rowExpand = rowExpanded.size ? Math.trunc(remaining.y / rowExpanded.size) : 0;
    let colOfs = 0;
    let rowOfs = 0;
    cells.forEach((c, idx) => {
      const row = Math.trunc(idx / this._columns);
      const col = idx % this._columns;
      if (col === 0) {
        colOfs = 0;
        if (row > 0) rowOfs += (rowExpanded.has(row - 1) ? rowExpand : rowMin.get(row - 1)) + vSep;
      }
      const w = colExpanded.has(col) ? colExpand : colMin.get(col);
      const h = rowExpanded.has(row) ? rowExpand : rowMin.get(row);
      this.fit_child_in_rect(c, { x: colOfs, y: rowOfs, w, h });
      colOfs += w + hSep;
    });
  }
}
