/**
 * GuiViewport — the root viewport's GUI half, as Godot's Viewport runs it:
 *
 *   content scale   Window::_update_viewport_size for stretch mode canvas_items, aspect expand and
 *                   base 1600×900: the canvas is floor(base grown to the window's aspect) / ui_scale
 *                   units, stretched to the window per axis; font oversampling is the larger scale;
 *   hover           before ANY mouse event is dispatched, the control under the pointer becomes the
 *                   hovered one (Viewport::_update_mouse_over, whatever button is held): the "mouse
 *                   over hierarchy" (control + non-IGNORE ancestors up to the first STOP) gets
 *                   mouse_exited children first and mouse_entered parents first;
 *   mouse           a press picks the mouse focus (reverse draw order, clip_contents respected,
 *                   mouse_filter IGNORE skipped) and keeps it, with a mask of the held buttons, until
 *                   the last release; gui_input climbs through the ancestors until accepted or a STOP
 *                   control swallows it (motion included); cursor shape from the chain;
 *   focus           a left click focuses the first focusable control up the chain, only if hovered,
 *                   and HIDES that focus (project setting show_focus_state_on_pointer_event = 1): a
 *                   button drawn with has_focus(true) shows no focus box until keys move the focus;
 *   keys            focus owner first; then ui_focus_next/prev (tree order) and ui_up/down/left/right
 *                   (geometric neighbours), ported in focus.js; anything left becomes unhandled input
 *                   for the scene tree (reverse tree order);
 *   tooltips        tooltip_delay (0.5 s, unscaled) after the pointer rests on a control with tooltip
 *                   text (own or an ancestor's up to a STOP), restarted by another control or 5 px of
 *                   movement; a TooltipPanel with a TooltipLabel or _make_custom_tooltip, offset
 *                   (10, 10) from where the wait began, flipped to stay on screen;
 *   popups          OptionButton menus on a top layer, closed by an outside press;
 *   text input      a hidden DOM <input> bridges typing / IME / the mobile keyboard into LineEdit.
 */
import { Node } from '../scene.js';
import { Control, Gui, MOUSE_FILTER, FOCUS, CURSOR } from './control.js';
import { CanvasLayer, CanvasItem } from './canvas_item.js';
import { PanelContainer } from './containers.js';
import { Label } from './label.js';
import { BASE_GLOBALS } from './theme.js';
import { InputEvent, MOUSE_BUTTON as MouseButton } from '../input.js';
import { SIDE, findNextValidFocus, findPrevValidFocus, focusNeighbor } from './focus.js';

export const BASE_SIZE = Object.freeze({ x: 1600, y: 900 });
const F = Math.fround;
const CMP_EPSILON = 0.00001;

/** Math::is_equal_approx for floats. */
function isEqualApprox(a, b) {
  if (a === b) return true;
  const tolerance = Math.max(F(CMP_EPSILON * Math.abs(a)), F(CMP_EPSILON));
  return Math.abs(a - b) < tolerance;
}

/**
 * Window::_update_viewport_size + Viewport::_set_size for canvas_items / expand.
 * Returns { size: canvas units, stretch: canvas unit → pixels per axis, oversampling }.
 */
export function contentScale(pixelWidth, pixelHeight, factor, base = BASE_SIZE) {
  const viewportAspect = F(base.x / base.y);
  const videoAspect = F(pixelWidth / pixelHeight);
  let width = base.x;
  let height = base.y;
  if (!isEqualApprox(viewportAspect, videoAspect)) {
    if (viewportAspect < videoAspect) width = F(base.y * videoAspect);
    else height = F(base.x / videoAspect);
  }
  const size = { x: F(Math.floor(width) / F(factor)), y: F(Math.floor(height) / F(factor)) };
  const stretch = { x: F(pixelWidth / size.x), y: F(pixelHeight / size.y) };
  return { size, stretch, oversampling: Math.max(stretch.x, stretch.y) };
}
const TOOLTIP_LAYER = 128;
const POPUP_LAYER = 100;

const CURSOR_CSS = { [CURSOR.ARROW]: 'default', [CURSOR.IBEAM]: 'text', [CURSOR.POINTING_HAND]: 'pointer' };

/**
 * gui/common/show_focus_state_on_pointer_event is 1 in the shipped project (read from the original
 * build by _oracle/probe_gui_settings.gd): below 2, a focus taken with the pointer is hidden.
 */
const SHOW_FOCUS_STATE_ON_POINTER_EVENT = 1;
const CAN_HIDE_FOCUS_STATE = SHOW_FOCUS_STATE_ON_POINTER_EVENT < 2;
/** The buttons Viewport::_drop_mouse_focus releases (left, right, middle). */
const MOUSE_FOCUS_BUTTONS = 3;
/** The tooltip wait restarts after the pointer moves this far (5 px, squared). */
const TOOLTIP_MOVE_SQUARED = 25;
/** Keys that move the focus to a neighbour, in the order the engine tests them. */
const NAVIGATION = Object.freeze([
  ['ui_up', SIDE.TOP],
  ['ui_left', SIDE.LEFT],
  ['ui_right', SIDE.RIGHT],
  ['ui_down', SIDE.BOTTOM],
]);

/** mouse_button_to_mask. */
const buttonMask = (button) => 1 << (button - 1);

/**
 * Viewport::_gui_get_tooltip: the first tooltip text up from `control` (stopping at a STOP control),
 * and the control that owns it. O(depth).
 */
function tooltipAt(control, point) {
  let position = point;
  let text = '';
  let owner = null;
  for (let item = control; item; item = item.get_parent_control()) {
    text = item.get_tooltip(position);
    owner = item;
    if (text) break;
    if (item.mouse_filter === MOUSE_FILTER.STOP || item.top_level === true) break;
    const m = item.get_transform();
    position = { x: m[0] * position.x + m[2] * position.y + m[4], y: m[1] * position.x + m[3] * position.y + m[5] };
  }
  return { text, owner };
}

export class GuiViewport {
  /**
   * @param {import('../scene.js').SceneTree} tree
   * @param {{ uiScale?: () => number }} options
   */
  constructor(tree, options = {}) {
    this.tree = tree;
    this.uiScale = options.uiScale ?? (() => 1);
    this.size = { x: BASE_SIZE.x, y: BASE_SIZE.y };
    /** Canvas unit → device pixels, per axis (Viewport.stretch_transform). */
    this.stretch = { x: 1, y: 1 };
    /** Viewport.get_oversampling(): the scale glyphs are rasterised for. */
    this.oversampling = 1;
    this.pixelSize = { x: BASE_SIZE.x, y: BASE_SIZE.y };
    /** gui.key_focus, and whether its focus is hidden (taken with the pointer). */
    this.focusOwner = null;
    this.hideFocus = false;
    /** gui.mouse_over and gui.mouse_over_hierarchy (outermost ancestor first). */
    this.mouseOver = null;
    this.hoverHierarchy = [];
    /** gui.mouse_focus and gui.mouse_focus_mask (the held buttons, mouse_button_to_mask bits). */
    this.mouseFocus = null;
    this.mouseFocusMask = 0;
    /** gui.last_mouse_pos, in canvas units. */
    this.mousePosition = { x: -1, y: -1 };
    this.cursor = 'default';
    /** Whether the event being pushed has been handled (set_input_as_handled). */
    this._handled = false;
    this._sendingHoverNotifications = false;
    this._tooltip = null;
    this._tooltipControl = null;
    /** gui.tooltip_pos: where the tooltip wait began, in device pixels. */
    this._tooltipPosition = { x: -1e9, y: -1e9 };
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
    const { size, stretch, oversampling } = contentScale(pixelWidth, pixelHeight, this.uiScale());
    this.stretch = stretch;
    this.oversampling = oversampling;
    if (size.x !== this.size.x || size.y !== this.size.y) {
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

  /**
   * Viewport::_gui_control_has_focus. `ignoreHiddenFocus`: a focus taken by a click is hidden (the
   * project keeps gui/common/show_focus_state_on_pointer_event at 1) and does not count then.
   */
  hasFocus(control, ignoreHiddenFocus = false) {
    return (!ignoreHiddenFocus || !this.hideFocus) && this.focusOwner === control;
  }

  /** Viewport::_gui_control_grab_focus. */
  grabFocus(control, hideFocus = false) {
    if (this.focusOwner === control) {
      // Only the visibility of the focus changes.
      if (hideFocus !== this.hideFocus && CAN_HIDE_FOCUS_STATE) {
        this.hideFocus = hideFocus;
        control.queue_redraw();
      }
      return;
    }
    this.releaseFocus();
    if (!control._inside) return;
    this.focusOwner = control;
    if (CAN_HIDE_FOCUS_STATE) this.hideFocus = hideFocus;
    control._notify_focus_enter();
    control.queue_redraw();
  }

  /** Viewport::gui_release_focus: the owner is cleared first, then told (NOTIFICATION_FOCUS_EXIT). */
  releaseFocus() {
    const previous = this.focusOwner;
    if (!previous) return;
    this.focusOwner = null;
    previous._notify_focus_exit();
    previous.queue_redraw();
  }

  /** Viewport::_gui_remove_control: a control leaves the tree. */
  _controlExited(control) {
    if (this.mouseFocus === control) {
      this.mouseFocus = null;
      this.mouseFocusMask = 0;
    }
    if (this.focusOwner === control) this.focusOwner = null;
    if (this.mouseOver === control || this.hoverHierarchy.includes(control)) this._dropMouseOver(control.get_parent_control());
    if (this._tooltipControl === control) this._tooltipControl = null;
  }

  /** Viewport::_gui_hide_control: a control stops being visible in the tree (each descendant is told). */
  _controlHidden(control) {
    if (this.mouseFocus === control) this._dropMouseFocus();
    if (this.focusOwner === control) this.releaseFocus();
    if (this.mouseOver === control || this.hoverHierarchy.includes(control)) this._dropMouseOver(control.get_parent_control());
    if (this._tooltipControl === control) this._cancelTooltip();
  }

  /** Viewport::_drop_mouse_focus: the pressed control gets its releases, then lets go. */
  _dropMouseFocus() {
    const control = this.mouseFocus;
    const mask = this.mouseFocusMask;
    this.mouseFocus = null;
    this.mouseFocusMask = 0;
    if (!control) return;
    for (let button = 1; button <= MOUSE_FOCUS_BUTTONS; button++) {
      if (!(mask & buttonMask(button))) continue;
      const local = control.toLocal(this.mousePosition);
      control._call_gui_input(new InputEvent('mouse_button', { button_index: button, pressed: false, position: local, globalPosition: local, echo: false, internal: true }));
    }
  }

  /** `accept_event()` / `set_input_as_handled()` from inside the GUI. */
  acceptEvent() {
    this._handled = true;
  }

  // ─────────────────────────────────────────────────────────────── hover ─────────────────────────

  /**
   * Viewport::_update_mouse_over(pos), run for EVERY mouse event before it is dispatched (motion,
   * press, release, wheel): the control under the pointer becomes the one hovered, whatever button
   * is held. The chain of hovered ancestors grows from the first ancestor both chains share: the
   * controls that leave get mouse_exited children first, the ones that arrive mouse_entered parents
   * first. O(depth).
   */
  _updateMouseOver(point) {
    this.mousePosition = { x: point.x, y: point.y };
    const over = this.findControl(point);
    if (over === this.mouseOver && !(over === null && this.hoverHierarchy.length > 0)) return;
    if (this._sendingHoverNotifications) {
      // Enter / exit handlers that move things around: settle it on the next frame, like the engine.
      this.tree.callDeferred(() => this._updateMouseOver(this.mousePosition));
      return;
    }
    let common = null;
    const arriving = [];
    for (let item = over; item instanceof CanvasItem; item = item.parent) {
      if (item instanceof Control) {
        if (item.mouse_filter !== MOUSE_FILTER.IGNORE) {
          if (this.hoverHierarchy.includes(item)) {
            common = item;
            break;
          }
          arriving.push(item);
        }
        if (item.mouse_filter === MOUSE_FILTER.STOP) break;
      }
      if (item.top_level === true) break;
    }
    if (this.mouseOver !== null || this.hoverHierarchy.length > 0) this._dropMouseOver(common);
    if (!over) return;
    this.mouseOver = over;
    this._sendingHoverNotifications = true;
    try {
      for (let i = arriving.length - 1; i >= 0; i--) {
        const control = arriving[i];
        this.hoverHierarchy.push(control);
        control._notify_mouse_enter();
        control.mouse_entered.emit();
      }
    } finally {
      this._sendingHoverNotifications = false;
    }
  }

  /**
   * Viewport::_drop_mouse_over(until): nothing is hovered any more below `until` (kept, with its
   * ancestors). Cancels the tooltip, as the engine does on every change of hover.
   */
  _dropMouseOver(until = null) {
    if (this._sendingHoverNotifications) {
      this.tree.callDeferred(() => this._dropMouseOver(until));
      return;
    }
    this._cancelTooltip();
    this._sendingHoverNotifications = true;
    try {
      this.mouseOver = null;
      const keep = until ? this.hoverHierarchy.indexOf(until) + 1 : 0;
      for (let i = this.hoverHierarchy.length - 1; i >= keep; i--) {
        const control = this.hoverHierarchy[i];
        if (!control._inside) continue;
        control._notify_mouse_exit();
        control.mouse_exited.emit();
      }
      this.hoverHierarchy.length = Math.max(0, keep);
    } finally {
      this._sendingHoverNotifications = false;
    }
  }

  // ─────────────────────────────────────────────────────────────── dispatch ──────────────────────

  /**
   * Viewport::_gui_call_input: the event goes to `control`, then up through its ancestors until a
   * STOP control swallows a pointer event or someone accepts it; each ancestor gets it in its own
   * coordinates. O(depth).
   */
  _callGuiInput(control, event) {
    const pointer = event.kind === 'mouse_button' || event.kind === 'mouse_motion';
    for (let item = control; item instanceof CanvasItem; item = item.parent) {
      if (item instanceof Control) {
        if (item.mouse_filter !== MOUSE_FILTER.IGNORE) {
          const local = pointer ? event.at(item.toLocal(event.globalPosition)) : event;
          item._call_gui_input(local);
        }
        if (!item._inside || item.top_level === true) break;
        if (item.mouse_filter === MOUSE_FILTER.STOP && pointer) {
          this._handled = true;
          break;
        }
      }
      if (this._handled) break;
      if (item.top_level === true) break;
    }
  }

  /**
   * Viewport::push_input. Mouse events first update what is hovered; open popups (the engine's
   * embedded windows) see input before the GUI; what the GUI leaves goes to _unhandled_input.
   * Returns whether the event was handled.
   */
  push(event) {
    if (event.position) event.globalPosition = { x: event.position.x, y: event.position.y };
    this._handled = false;
    const mouse = event.kind === 'mouse_button' || event.kind === 'mouse_motion';
    if (mouse) this._updateMouseOver(event.globalPosition);
    if (this._popupInput(event)) return true;
    if (event.kind === 'mouse_button') this._mouseButton(event);
    else if (event.kind === 'mouse_motion') this._mouseMotion(event);
    else if (event.kind === 'key' || event.kind === 'joy_button' || event.kind === 'action') this._key(event);
    if (!this._handled) this._handled = this.tree.dispatchUnhandledInput(event);
    return this._handled;
  }

  /** An open popup menu gets keys, and a press outside closes it (and is swallowed). */
  _popupInput(event) {
    const popup = this.popups[this.popups.length - 1];
    if (!popup) return false;
    if (event.kind === 'key' || event.kind === 'joy_button') {
      popup._gui_input(event);
      return true;
    }
    if (event.kind === 'mouse_button' && event.pressed && event.button_index < MouseButton.WHEEL_UP && !popup.has_point(popup.toLocal(event.globalPosition))) {
      popup.close(-1);
      return true;
    }
    return false;
  }

  /** Viewport::_gui_input_event for InputEventMouseButton. */
  _mouseButton(event) {
    const point = event.globalPosition;
    const mask = buttonMask(event.button_index);
    if (event.pressed) {
      if (this.mouseFocusMask !== 0 && !(this.mouseFocusMask & mask)) {
        // Another button is already held: no stealing of the mouse focus.
        if (!this.mouseFocus) return;
        this.mouseFocusMask |= mask;
      } else {
        this.mouseFocus = this.findControl(point);
        if (!this.mouseFocus) {
          // A click on nothing hides the focus, even when its holder stays the same.
          if (this.focusOwner && event.button_index === MouseButton.LEFT && CAN_HIDE_FOCUS_STATE) {
            this.hideFocus = true;
            this.focusOwner.queue_redraw();
          }
          return;
        }
        this.mouseFocusMask |= mask;
      }
      const target = this.mouseFocus;
      if (event.button_index === MouseButton.LEFT) this._focusFromClick(target);
      if (target._inside) this._callGuiInput(target, event);
      this._cancelTooltip();
      return;
    }
    this.mouseFocusMask &= ~mask;
    // The release only goes to a control that saw the press.
    if (!this.mouseFocus) return;
    const target = this.mouseFocus;
    // Let go before the call: a popup opened by the press must not wait for this release.
    if (this.mouseFocusMask === 0) this.mouseFocus = null;
    if (target._inside) this._callGuiInput(target, event);
  }

  /**
   * The focus a left click gives: the first focusable control from the clicked one upwards (within
   * its STOP boundary), and only when the pointer is really over it; hidden, since it came from a
   * pointer.
   */
  _focusFromClick(target) {
    for (let item = target; item instanceof CanvasItem; item = item.parent) {
      if (item instanceof Control) {
        if (item._is_focusable()) {
          if (this.hoverHierarchy.includes(item)) item.grab_focus(true);
          return;
        }
        if (item.mouse_filter === MOUSE_FILTER.STOP) return;
      }
      if (item.top_level === true) return;
    }
  }

  /** Viewport::_gui_input_event for InputEventMouseMotion. */
  _mouseMotion(event) {
    const point = event.globalPosition;
    const over = this.mouseFocus ?? this.findControl(point);
    let shape = CURSOR.ARROW;
    if (over) {
      const local = over.toLocal(point);
      if (!event.button_mask) this._followTooltip(over, point);
      // The cursor: the first shape other than the arrow up the chain.
      let position = local;
      for (let control = over; control; control = control.get_parent_control()) {
        shape = this.mouseFocusMask !== 0 || control.has_point(position) ? control.get_cursor_shape(position) : CURSOR.ARROW;
        const m = control.get_transform();
        position = { x: m[0] * position.x + m[2] * position.y + m[4], y: m[1] * position.x + m[3] * position.y + m[5] };
        if (shape !== CURSOR.ARROW || control.mouse_filter === MOUSE_FILTER.STOP || control.top_level === true) break;
      }
      if (over._inside) this._callGuiInput(over, event);
    }
    this.cursor = CURSOR_CSS[shape] ?? 'default';
  }

  /** Viewport::_gui_input_event for key and gamepad events: the focus owner, then navigation. */
  _key(event) {
    if (this.focusOwner && !this.focusOwner.is_visible_in_tree()) this.focusOwner.release_focus();
    if (this.focusOwner) {
      if (this.focusOwner._inside) this.focusOwner._call_gui_input(event);
      if (this._handled) return;
    }
    // Without a focus owner the engine starts from the first visible Control child of the viewport
    // itself; the game keeps its GUI under CanvasLayers, so there is none and nothing moves.
    const from = this.focusOwner ?? this.tree.root.children.find((child) => child instanceof Control && child.is_visible_in_tree() && child.top_level !== true) ?? null;
    if (!from || !event.pressed) return;
    let next = null;
    let showFocus = false;
    if (event.is_action_pressed('ui_focus_next', true)) {
      next = findNextValidFocus(from);
      showFocus = true;
    }
    if (event.is_action_pressed('ui_focus_prev', true)) {
      next = findPrevValidFocus(from);
      showFocus = true;
    }
    for (const [action, side] of NAVIGATION) {
      if (!event.is_action_pressed(action, true)) continue;
      next = focusNeighbor(from, side);
      showFocus = true;
    }
    if (next) {
      next.grab_focus();
      this._handled = true;
    } else if (showFocus && this.hideFocus && this.focusOwner) {
      // Show the focus even if its holder did not change, as feedback.
      this.hideFocus = false;
      this.focusOwner.queue_redraw();
    }
  }

  // ─────────────────────────────────────────────────────────────── tooltips & popups ─────────────

  /**
   * The tooltip part of a motion without buttons: a tooltip on screen stays while its text does; the
   * timer restarts when the pointer enters another control or moves more than 5 pixels.
   */
  _followTooltip(over, point) {
    let shown = false;
    if (this._tooltip) {
      if (this._tooltipControl) {
        const text = tooltipAt(over, this._tooltipControl.toLocal(point)).text.trim();
        if (text !== this._tooltipText) this._cancelTooltip();
        else shown = true;
      } else {
        this._cancelTooltip();
      }
    }
    if (shown) return;
    const pixel = { x: point.x * this.stretch.x, y: point.y * this.stretch.y };
    const dx = pixel.x - this._tooltipPosition.x;
    const dy = pixel.y - this._tooltipPosition.y;
    if (over !== this._tooltipControl || dx * dx + dy * dy > TOOLTIP_MOVE_SQUARED) {
      this._tooltipControl = over;
      this._tooltipPosition = pixel;
      this._tooltipTimer = BASE_GLOBALS.tooltip_delay;
    }
  }

  /** Per-frame bookkeeping: the tooltip timer, on the unscaled clock (the engine's ignores time_scale). */
  process(delta) {
    if (this._tooltipTimer > 0) {
      this._tooltipTimer -= delta;
      if (this._tooltipTimer <= 0) this._showTooltip();
    }
  }

  /** Viewport::_gui_show_tooltip_at(last mouse position). */
  _showTooltip() {
    this._tooltipTimer = -1;
    const control = this._tooltipControl;
    if (!control || !control.is_visible_in_tree()) return;
    const { text, owner } = tooltipAt(control, control.toLocal(this.mousePosition));
    this._tooltipText = text.trim();
    const custom = owner?._make_custom_tooltip?.(this._tooltipText) ?? null;
    if (!this._tooltipText && !custom) return;
    if (!owner) return;
    this._removeTooltipPanel();
    const panel = new PanelContainer();
    panel.theme_type_variation = 'TooltipPanel';
    panel.mouse_filter = MOUSE_FILTER.IGNORE;
    panel.theme = owner.find_theme();
    let content = custom;
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
      panel.position = this._tooltipPlacement(panel.size);
    };
    place();
    this.tree.callDeferred(place);
    panel.minimum_size_changed.connect(place);
  }

  /**
   * Where the engine puts the tooltip: offset from the point where its timer started; flipped to the
   * other side of that point when it would leave the window, hugging the far border if that fails too.
   */
  _tooltipPlacement(size) {
    // The engine works in window pixels: the popup is scaled by the smaller stretch, sized up to whole
    // pixels, and placed at a whole pixel (Window::popup takes a Rect2i).
    const scale = Math.min(this.stretch.x, this.stretch.y);
    const offset = { x: BASE_GLOBALS.tooltip_offset[0] * scale, y: BASE_GLOBALS.tooltip_offset[1] * scale };
    const at = this._tooltipPosition;
    const width = Math.ceil(size.x * scale);
    const height = Math.ceil(size.y * scale);
    const view = this.pixelSize;
    let x = at.x + offset.x;
    let y = at.y + offset.y;
    if (x + width > view.x) {
      x = at.x - width - offset.x;
      if (x < 0) x = view.x - width;
    } else if (x < 0) x = 0;
    if (y + height > view.y) {
      y = at.y - height - offset.y;
      if (y < 0) y = view.y - height;
    } else if (y < 0) y = 0;
    return { x: Math.trunc(x) / this.stretch.x, y: Math.trunc(y) / this.stretch.y };
  }

  /** Viewport::_gui_cancel_tooltip. */
  _cancelTooltip() {
    this._tooltipControl = null;
    this._tooltipText = '';
    this._tooltipTimer = -1;
    this._removeTooltipPanel();
  }

  _removeTooltipPanel() {
    if (!this._tooltip) return;
    this._tooltip.queue_free();
    this._tooltip = null;
  }

  /**
   * A popup menu (the engine's embedded popup window) under `owner`. It takes the keys while open; its
   * window has a focus of its own, so the owner's focus comes back as it was when it closes.
   */
  openPopup(popup, owner) {
    popup._restoreFocus = { control: this.focusOwner, hidden: this.hideFocus };
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
    const restore = popup._restoreFocus;
    if (restore?.control?._inside) restore.control.grab_focus(restore.hidden);
    else if (this.focusOwner === popup) this.releaseFocus();
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
