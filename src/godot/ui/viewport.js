/**
 * GuiViewport — the root viewport's GUI half, as Godot's Viewport runs it:
 *
 *   content scale   stretch mode canvas_items, aspect expand, base 1600×900: one canvas unit is
 *                   min(w/1600, h/900) × ui_scale device pixels; the canvas keeps the window's aspect;
 *   mouse           the control under the pointer (reverse draw order, clip_contents respected,
 *                   mouse_filter IGNORE skipped), gui_input propagated up through PASS parents until
 *                   accepted or a STOP control, mouse focus kept by the pressed control until release;
 *   hover           the "mouse over hierarchy" (control + PASS ancestors up to the first STOP) gets
 *                   mouse_entered / mouse_exited; cursor shape from the hovered control;
 *   keys            focus owner first; then ui_focus_next/prev and ui_up/down/left/right navigation;
 *                   anything left becomes unhandled input for the scene tree (reverse tree order);
 *   tooltips        after tooltip_delay (0.5 s) over a control with tooltip text (own or a PASS
 *                   ancestor's), a TooltipPanel with a TooltipLabel or _make_custom_tooltip at the
 *                   pointer + (10, 10), kept on screen;
 *   popups          OptionButton menus on a top layer, closed by an outside press;
 *   text input      a hidden DOM <input> bridges typing / IME / the mobile keyboard into LineEdit.
 */
import { Node } from '../scene.js';
import { Control, Gui, MOUSE_FILTER, FOCUS, CURSOR } from './control.js';
import { CanvasLayer, CanvasItem } from './canvas_item.js';
import { PanelContainer } from './containers.js';
import { Label } from './label.js';
import { BASE_GLOBALS } from './theme.js';

export const BASE_SIZE = Object.freeze({ x: 1600, y: 900 });
const TOOLTIP_LAYER = 128;
const POPUP_LAYER = 100;

const CURSOR_CSS = { [CURSOR.ARROW]: 'default', [CURSOR.IBEAM]: 'text', [CURSOR.POINTING_HAND]: 'pointer' };

export class GuiViewport {
  /**
   * @param {import('../scene.js').SceneTree} tree
   * @param {{ uiScale?: () => number }} options
   */
  constructor(tree, options = {}) {
    this.tree = tree;
    this.uiScale = options.uiScale ?? (() => 1);
    this.size = { x: BASE_SIZE.x, y: BASE_SIZE.y };
    this.scale = 1;
    this.pixelSize = { x: BASE_SIZE.x, y: BASE_SIZE.y };
    this.focusOwner = null;
    this.hoverHierarchy = [];
    this.mouseFocus = null;
    this.mouseButtonsHeld = 0;
    this.mousePosition = { x: -1, y: -1 };
    this.cursor = 'default';
    this._accepted = false;
    this._tooltip = null;
    this._tooltipOwner = null;
    this._tooltipTimer = -1;
    this._tooltipText = '';
    this.popups = [];
    this.textInput = null;
    this.tooltipLayer = new CanvasLayer(TOOLTIP_LAYER);
    this.popupLayer = new CanvasLayer(POPUP_LAYER);
    tree.root.add_child(this.popupLayer);
    tree.root.add_child(this.tooltipLayer);
    Gui.viewport = this;
  }

  /** Window (drawing buffer) size in device pixels → canvas size and scale. */
  resize(pixelWidth, pixelHeight) {
    this.pixelSize = { x: pixelWidth, y: pixelHeight };
    const stretch = Math.min(pixelWidth / BASE_SIZE.x, pixelHeight / BASE_SIZE.y);
    this.scale = stretch * this.uiScale();
    const size = { x: pixelWidth / this.scale, y: pixelHeight / this.scale };
    if (Math.abs(size.x - this.size.x) > 1e-6 || Math.abs(size.y - this.size.y) > 1e-6) {
      this.size = size;
      this._eachLayerRoot((control) => control._size_changed());
    }
  }

  get_visible_rect() {
    return { x: 0, y: 0, w: this.size.x, h: this.size.y };
  }

  _layers() {
    const layers = [];
    const collect = (node) => {
      for (const child of node.children) {
        if (child instanceof CanvasLayer) layers.push(child);
        else if (!(child instanceof CanvasItem)) collect(child);
      }
    };
    collect(this.tree.root);
    return layers.sort((a, b) => a.layer - b.layer);
  }

  _eachLayerRoot(fn) {
    for (const layer of this._layers()) for (const child of layer.children) if (child instanceof Control) fn(child);
  }

  // ─────────────────────────────────────────────────────────────── picking ───────────────────────

  /** Viewport::gui_find_control — topmost control under a canvas point. */
  findControl(point) {
    const layers = this._layers();
    for (let l = layers.length - 1; l >= 0; l--) {
      if (layers[l].visible === false) continue;
      const children = layers[l].children;
      for (let i = children.length - 1; i >= 0; i--) {
        const hit = this._findAt(children[i], point, [1, 0, 0, 1, 0, 0]);
        if (hit) return hit;
      }
    }
    return null;
  }

  _findAt(item, point, parentTransform) {
    if (!(item instanceof CanvasItem) || !item._visible) return null;
    const m = item.get_transform();
    const t = [
      parentTransform[0] * m[0] + parentTransform[2] * m[1],
      parentTransform[1] * m[0] + parentTransform[3] * m[1],
      parentTransform[0] * m[2] + parentTransform[2] * m[3],
      parentTransform[1] * m[2] + parentTransform[3] * m[3],
      parentTransform[0] * m[4] + parentTransform[2] * m[5] + parentTransform[4],
      parentTransform[1] * m[4] + parentTransform[3] * m[5] + parentTransform[5],
    ];
    const det = t[0] * t[3] - t[1] * t[2];
    const dx = point.x - t[4];
    const dy = point.y - t[5];
    const local = { x: (t[3] * dx - t[2] * dy) / det, y: (-t[1] * dx + t[0] * dy) / det };
    const isControl = item instanceof Control;
    if (isControl && item.clip_contents && !item.has_point(local)) return null;
    for (let i = item.children.length - 1; i >= 0; i--) {
      const hit = this._findAt(item.children[i], point, t);
      if (hit) return hit;
    }
    if (isControl && item.mouse_filter !== MOUSE_FILTER.IGNORE && item.has_point(local)) return item;
    return null;
  }

  // ─────────────────────────────────────────────────────────────── focus ─────────────────────────

  setFocus(control) {
    if (control === this.focusOwner) return;
    const previous = this.focusOwner;
    this.focusOwner = control;
    if (previous) {
      previous._focusLost?.();
      previous.focus_exited.emit();
      previous.queue_redraw();
    }
    if (control) {
      control.focus_entered.emit();
      control.queue_redraw();
    }
  }

  _controlExited(control) {
    if (this.focusOwner === control) this.focusOwner = null;
    if (this.mouseFocus === control) this.mouseFocus = null;
    this.hoverHierarchy = this.hoverHierarchy.filter((c) => c !== control);
    if (this._tooltipOwner === control) this._hideTooltip();
  }

  _controlHidden(control) {
    for (let node = this.focusOwner; node; node = node.parent) {
      if (node === control) {
        this.setFocus(null);
        break;
      }
    }
  }

  acceptEvent() {
    this._accepted = true;
  }

  _focusable() {
    const out = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (child instanceof CanvasItem && !child._visible) continue;
        if (child instanceof CanvasLayer && child.visible === false) continue;
        if (child instanceof Control && child.focus_mode === FOCUS.ALL && child.is_visible_in_tree() && !child.disabled) out.push(child);
        walk(child);
      }
    };
    walk(this.tree.root);
    return out;
  }

  _modalScope(control) {
    // Keyboard navigation stays inside the topmost modal-like layer child that holds the focus.
    let scope = control;
    while (scope.parent && !(scope.parent instanceof CanvasLayer)) scope = scope.parent;
    return scope;
  }

  /** Tab order (find_next_valid_focus) or geometric neighbour (find_valid_focus_neighbor). */
  _navigate(event) {
    const current = this.focusOwner;
    const candidates = this._focusable();
    if (candidates.length === 0) return false;
    if (!current) {
      if (event.is_action('ui_focus_next') || event.is_action('ui_down') || event.is_action('ui_right') || event.is_action('ui_up') || event.is_action('ui_left')) {
        candidates[0].grab_focus();
        return true;
      }
      return false;
    }
    const scope = this._modalScope(current);
    const inScope = candidates.filter((c) => {
      for (let n = c; n; n = n.parent) if (n === scope) return true;
      return false;
    });
    if (event.is_action('ui_focus_next') || event.is_action('ui_focus_prev')) {
      const index = inScope.indexOf(current);
      const step = event.is_action('ui_focus_next') ? 1 : -1;
      const next = inScope[(index + step + inScope.length) % inScope.length];
      next?.grab_focus();
      return Boolean(next);
    }
    const dirs = { ui_up: { x: 0, y: -1 }, ui_down: { x: 0, y: 1 }, ui_left: { x: -1, y: 0 }, ui_right: { x: 1, y: 0 } };
    const action = Object.keys(dirs).find((a) => event.is_action(a));
    if (!action) return false;
    const dir = dirs[action];
    const from = current.get_global_rect();
    const fromCentre = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
    let best = null;
    let bestScore = Infinity;
    for (const c of inScope) {
      if (c === current) continue;
      const r = c.get_global_rect();
      const centre = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      const along = (centre.x - fromCentre.x) * dir.x + (centre.y - fromCentre.y) * dir.y;
      if (along <= 1) continue;
      const across = Math.abs((centre.x - fromCentre.x) * dir.y) + Math.abs((centre.y - fromCentre.y) * dir.x);
      const score = along + across * 2;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best) {
      best.grab_focus();
      return true;
    }
    return false;
  }

  // ─────────────────────────────────────────────────────────────── dispatch ──────────────────────

  /** Sends an event to a control's gui_input, propagating up through PASS parents. */
  _callGuiInput(control, event) {
    this._accepted = false;
    for (let c = control; c instanceof Control; c = c.parent) {
      if (!c._inside || c._freed) break;
      const local = event.position ? event.at(c.toLocal(event.globalPosition)) : event;
      c._gui_input?.(local);
      c.gui_input.emit(local);
      if (this._accepted) return true;
      if (c.mouse_filter === MOUSE_FILTER.STOP) return event.kind !== 'mouse_motion';
      if (c.parent instanceof CanvasLayer) break;
    }
    return false;
  }

  /** Entry point for every input event (already carrying `actions`). Returns true if handled. */
  push(event) {
    if (event.position) event.globalPosition = { x: event.position.x, y: event.position.y };
    let handled = false;
    if (event.kind === 'mouse_button') handled = this._mouseButton(event);
    else if (event.kind === 'mouse_motion') handled = this._mouseMotion(event);
    else if (event.kind === 'key' || event.kind === 'joy_button' || event.kind === 'action') handled = this._key(event);
    if (!handled) handled = this.tree.dispatchUnhandledInput(event);
    return handled;
  }

  _mouseButton(event) {
    this.mousePosition = event.globalPosition;
    this._hideTooltip();
    const isWheel = event.button_index >= 4;
    if (event.pressed && !isWheel) {
      // An open popup closes on any press outside it (and swallows that press).
      const popup = this.popups[this.popups.length - 1];
      if (popup) {
        const local = popup.toLocal(event.globalPosition);
        if (!popup.has_point(local)) {
          popup.close(-1);
          return true;
        }
      }
      this.mouseButtonsHeld += 1;
    }
    let target = this.mouseFocus;
    if (!target || event.pressed) target = this.findControl(event.globalPosition);
    if (event.pressed && !isWheel) {
      this.mouseFocus = target;
      if (target && target.focus_mode !== FOCUS.NONE) target.grab_focus();
      else if (target && this.focusOwner && this.focusOwner !== target) {
        // Clicking elsewhere drops a text field's focus (as a click on a non-focusable area does).
        if (this.focusOwner.constructor.themeType === 'LineEdit') this.setFocus(null);
      }
    }
    let handled = false;
    if (target) handled = this._callGuiInput(target, event);
    if (!event.pressed && !isWheel) {
      this.mouseButtonsHeld = Math.max(0, this.mouseButtonsHeld - 1);
      if (this.mouseButtonsHeld === 0) this.mouseFocus = null;
      this._updateHover(event.globalPosition);
    }
    // A press that landed on any control (STOP) is consumed by the GUI.
    return handled || (target !== null && target.mouse_filter === MOUSE_FILTER.STOP && !isWheel);
  }

  _mouseMotion(event) {
    this.mousePosition = event.globalPosition;
    this._updateHover(event.globalPosition);
    const target = this.mouseFocus ?? this.hoverHierarchy[0] ?? null;
    if (target) this._callGuiInput(target, event);
    return false;
  }

  _key(event) {
    if (this.popups.length) {
      const popup = this.popups[this.popups.length - 1];
      popup._gui_input(event);
      return true;
    }
    if (this.focusOwner && this.focusOwner.is_visible_in_tree()) {
      this._accepted = false;
      this.focusOwner._gui_input?.(event);
      this.focusOwner.gui_input.emit(event);
      if (this._accepted) return true;
    }
    if (event.pressed && ['ui_focus_next', 'ui_focus_prev', 'ui_up', 'ui_down', 'ui_left', 'ui_right'].some((a) => event.is_action(a))) {
      if (this.focusOwner && this._navigate(event)) return true;
    }
    return false;
  }

  /** Mouse-over hierarchy: the control under the pointer and its PASS ancestors up to a STOP. */
  _updateHover(point) {
    const over = this.mouseFocus ? null : this.findControl(point);
    const hierarchy = [];
    for (let c = over; c instanceof Control; c = c.parent) {
      if (c.mouse_filter !== MOUSE_FILTER.IGNORE) hierarchy.push(c);
      if (c.mouse_filter === MOUSE_FILTER.STOP) break;
      if (c.parent instanceof CanvasLayer) break;
    }
    if (this.mouseFocus) return;
    const old = this.hoverHierarchy;
    for (const c of old) if (!hierarchy.includes(c) && c._inside) c.mouse_exited.emit();
    for (let i = hierarchy.length - 1; i >= 0; i--) if (!old.includes(hierarchy[i])) hierarchy[i].mouse_entered.emit();
    this.hoverHierarchy = hierarchy;
    const shape = over ? over.mouse_default_cursor_shape : CURSOR.ARROW;
    this.cursor = CURSOR_CSS[shape] ?? 'default';
    // Tooltip owner: first control in the chain with tooltip text (stopping at STOP).
    let owner = null;
    let text = '';
    for (let c = over; c instanceof Control; c = c.parent) {
      const local = c.toLocal(point);
      const tip = c.get_tooltip(local);
      if (tip) {
        owner = c;
        text = tip;
        break;
      }
      if (c.mouse_filter === MOUSE_FILTER.STOP || c.parent instanceof CanvasLayer) break;
    }
    if (owner !== this._tooltipOwner || text !== this._tooltipText) {
      this._hideTooltip();
      this._tooltipOwner = owner;
      this._tooltipText = text;
      this._tooltipTimer = owner ? BASE_GLOBALS.tooltip_delay : -1;
    }
  }

  // ─────────────────────────────────────────────────────────────── tooltips & popups ─────────────

  /** Per-frame bookkeeping: tooltip timer. */
  process(delta) {
    if (this._tooltipTimer > 0) {
      this._tooltipTimer -= delta;
      if (this._tooltipTimer <= 0) this._showTooltip();
    }
  }

  _showTooltip() {
    const owner = this._tooltipOwner;
    if (!owner || !owner.is_visible_in_tree()) return;
    const panel = new PanelContainer();
    panel.theme_type_variation = 'TooltipPanel';
    panel.mouse_filter = MOUSE_FILTER.IGNORE;
    panel.theme = owner.find_theme();
    let content = owner._make_custom_tooltip?.(this._tooltipText) ?? null;
    if (!content) {
      const label = new Label(this._tooltipText);
      label.theme_type_variation = 'TooltipLabel';
      content = label;
    }
    panel.add_child(content);
    this.tooltipLayer.add_child(panel);
    this._tooltip = panel;
    const place = () => {
      if (this._tooltip !== panel) return;
      panel.reset_size();
      const offset = BASE_GLOBALS.tooltip_offset;
      let x = this.mousePosition.x + offset[0];
      let y = this.mousePosition.y + offset[1];
      const size = panel.size;
      if (x + size.x > this.size.x) x = this.size.x - size.x;
      if (y + size.y > this.size.y) y = this.mousePosition.y - size.y - 1;
      panel.position = { x: Math.max(0, x), y: Math.max(0, y) };
    };
    place();
    this.tree.callDeferred(place);
    panel.minimum_size_changed.connect(place);
  }

  _hideTooltip() {
    this._tooltipTimer = -1;
    if (this._tooltip) {
      this._tooltip.queue_free();
      this._tooltip = null;
    }
  }

  openPopup(popup, owner) {
    this.popupLayer.add_child(popup);
    const rect = owner.get_global_rect();
    popup.reset_size();
    const size = popup.size;
    let y = rect.y + rect.h;
    if (y + size.y > this.size.y) y = rect.y - size.y;
    popup.position = { x: rect.x, y: Math.max(0, y) };
    this.popups.push(popup);
    popup.grab_focus();
  }

  closePopup(popup) {
    this.popups = this.popups.filter((p) => p !== popup);
    popup.queue_free();
  }
}

/**
 * Hidden <input> that carries text editing (keyboard, IME, clipboard, mobile keyboards) into the
 * focused LineEdit. The game ignores key events aimed at it.
 */
export class TextInputBridge {
  constructor(host = document.body) {
    const input = document.createElement('input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('autocapitalize', 'characters');
    Object.assign(input.style, { position: 'fixed', left: '0', top: '0', width: '1px', height: '1px', opacity: '0', border: '0', padding: '0', pointerEvents: 'none' });
    host.appendChild(input);
    this.input = input;
    this.target = null;
    input.addEventListener('input', () => this.target?._edited(input.value, input.selectionStart ?? input.value.length));
    input.addEventListener('keydown', (e) => {
      if (!this.target) return;
      if (e.key === 'Enter') {
        this.target.text_submitted.emit(this.target.text);
        e.preventDefault();
      } else if (e.key === 'Escape' || e.key === 'Tab') {
        this.target.release_focus();
      }
      e.stopPropagation();
    });
    input.addEventListener('keyup', (e) => {
      if (this.target) {
        this.target.caret_column = input.selectionStart ?? this.target.caret_column;
        this.target.queue_redraw();
        e.stopPropagation();
      }
    });
    input.addEventListener('blur', () => {
      if (this.target && this.target.has_focus()) this.target.release_focus();
    });
  }

  attach(lineEdit) {
    this.target = lineEdit;
    this.input.maxLength = lineEdit.max_length > 0 ? lineEdit.max_length : 524288;
    this.input.value = lineEdit.text;
    this.input.focus({ preventScroll: true });
    this.setCaret(lineEdit.caret_column);
  }

  setCaret(column) {
    try {
      this.input.setSelectionRange(column, column);
    } catch (error) {
      // Inputs that do not support selection ranges simply keep the browser's caret.
      console.debug('caret placement unavailable', error);
    }
  }

  detach(lineEdit) {
    if (this.target !== lineEdit) return;
    this.target = null;
    this.input.blur();
  }

  get active() {
    return this.target !== null;
  }
}

export { Node };
