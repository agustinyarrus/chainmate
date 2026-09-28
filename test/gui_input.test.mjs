/**
 * GUI input — the port's GuiViewport and BaseButton against Godot 4.7's rules (scene/main/viewport.cpp,
 * scene/gui/base_button.cpp, scene/gui/control.cpp), scenario by scenario:
 *
 *   hover       updated by every mouse event BEFORE it is dispatched (a press with no motion first
 *               still presses the button under it), whatever button is held, exits children first
 *   focus       a click gives a hidden focus (has_focus() yes, has_focus(true) no); keys show it;
 *               a click on nothing hides it without changing its owner
 *   buttons     press + release inside fires once; dragging out cancels; a press that did not start
 *               over the button does nothing; ui_accept presses the focused button and is NOT consumed
 *   stopping    a STOP control swallows pointer events, motion included; IGNORE lets them through
 *   navigation  Tab follows tree order and wraps inside the GUI root; arrows pick the nearest
 *               control past the edge; with nothing focused, keys focus nothing
 *   mouse focus a second button pressed elsewhere never steals the control holding the first
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Node, SceneTree } from '../src/godot/scene.js';
import { CanvasLayer } from '../src/godot/ui/canvas_item.js';
import { Control, MOUSE_FILTER, PRESET, FOCUS } from '../src/godot/ui/control.js';
import { BaseButton } from '../src/godot/ui/buttons.js';
import { GuiViewport } from '../src/godot/ui/viewport.js';
import { InputEvent, MOUSE_BUTTON } from '../src/godot/input.js';

const WIDTH = 1600;
const HEIGHT = 900;

function stage() {
  const tree = new SceneTree();
  const viewport = new GuiViewport(tree);
  viewport.resize(WIDTH, HEIGHT);
  const layer = new CanvasLayer(1);
  tree.root.add_child(layer);
  const root = new Control('Root');
  root.mouse_filter = MOUSE_FILTER.IGNORE;
  layer.add_child(root);
  root.set_anchors_and_offsets_preset(PRESET.FULL_RECT);
  const unhandled = [];
  const listener = new Node('Listener');
  listener._unhandled_input = (event) => unhandled.push(event.kind);
  tree.root.add_child(listener);
  return { tree, viewport, root, unhandled };
}

/** A BaseButton at (x, y), w × h, that records what happens to it. */
function button(parent, name, x, y, w = 100, h = 40) {
  const b = new BaseButton(name);
  parent.add_child(b);
  b.position = { x, y };
  b.size = { x: w, y: h };
  b.log = [];
  for (const signal of ['pressed', 'button_down', 'button_up', 'mouse_entered', 'mouse_exited', 'focus_entered', 'focus_exited']) b[signal].connect(() => b.log.push(signal));
  return b;
}

const motion = (x, y, mask = 0) => new InputEvent('mouse_motion', { position: { x, y }, relative: { x: 0, y: 0 }, button_mask: mask, pressed: false, echo: false });
const mouse = (x, y, pressed, index = MOUSE_BUTTON.LEFT) => new InputEvent('mouse_button', { button_index: index, pressed, position: { x, y }, echo: false });
const key = (code, pressed = true, shift = false) => new InputEvent('key', { code, keycode: code, physical_keycode: code, pressed, echo: false, shift });
const tap = (viewport, x, y) => {
  viewport.push(mouse(x, y, true));
  viewport.push(mouse(x, y, false));
};

test('hover is updated before a press is dispatched: a tap with no motion first still presses', () => {
  const { viewport, root } = stage();
  const a = button(root, 'A', 100, 100);
  tap(viewport, 120, 110);
  // The engine's order: hover (push_input), focus from the click, then the press reaches the button.
  assert.deepEqual(a.log, ['mouse_entered', 'focus_entered', 'button_down', 'pressed', 'button_up']);
  assert.equal(a.is_hovered(), true, 'still hovered after the release (the pointer did not move)');
});

test('a click gives a hidden focus; Tab shows it; a click on nothing hides it again', () => {
  const { viewport, root } = stage();
  const a = button(root, 'A', 100, 100);
  const b = button(root, 'B', 300, 100);
  tap(viewport, 120, 110);
  assert.equal(a.has_focus(), true, 'the click focused A');
  assert.equal(a.has_focus(true), false, 'but the focus is hidden (no focus box)');
  viewport.push(key('Tab'));
  assert.equal(b.has_focus(), true, 'Tab moved the focus to B');
  assert.equal(b.has_focus(true), true, 'and keys show the focus');
  tap(viewport, 1000, 700);
  assert.equal(b.has_focus(), true, 'a click on nothing keeps the owner');
  assert.equal(b.has_focus(true), false, 'but hides the focus');
});

test('dragging out of a pressed button cancels it; a press that started elsewhere does nothing', () => {
  const { viewport, root } = stage();
  const a = button(root, 'A', 100, 100);
  viewport.push(motion(120, 110));
  viewport.push(mouse(120, 110, true));
  viewport.push(motion(600, 600, 1));
  assert.equal(a.is_hovered(), false, 'the hover follows the pointer while the button is held');
  viewport.push(mouse(600, 600, false));
  assert.equal(a.log.includes('pressed'), false, 'released outside: not pressed');
  assert.deepEqual(a.log.filter((s) => s === 'button_down' || s === 'button_up'), ['button_down', 'button_up']);

  a.log.length = 0;
  viewport.push(mouse(700, 700, true));
  viewport.push(motion(120, 110, 1));
  viewport.push(mouse(120, 110, false));
  assert.equal(a.log.includes('pressed'), false, 'a press that started on nothing never reaches the button');
});

test('ui_accept presses the focused button and is not consumed (keys go on to _unhandled_input)', () => {
  const { viewport, root, unhandled } = stage();
  const a = button(root, 'A', 100, 100);
  a.grab_focus();
  viewport.push(key('Enter', true));
  viewport.push(key('Enter', false));
  assert.deepEqual(a.log.filter((s) => s === 'pressed'), ['pressed']);
  assert.equal(unhandled.filter((k) => k === 'key').length, 2, 'both key events reached _unhandled_input');
});

test('a STOP control swallows pointer events (motion too); IGNORE lets them through', () => {
  const { viewport, root, unhandled } = stage();
  const panel = new Control('Panel');
  root.add_child(panel);
  panel.position = { x: 500, y: 500 };
  panel.size = { x: 200, y: 200 };
  assert.equal(viewport.push(motion(600, 600)), true, 'motion over a STOP control is handled');
  assert.equal(viewport.push(motion(100, 800)), false, 'motion over nothing is not');
  assert.deepEqual(unhandled, ['mouse_motion']);
  panel.mouse_filter = MOUSE_FILTER.IGNORE;
  assert.equal(viewport.push(motion(600, 600)), false, 'IGNORE: the event goes on');
});

test('hover exits go children first, enters parents first, sharing the common ancestor', () => {
  const { viewport, root } = stage();
  const card = new Control('Card');
  card.mouse_filter = MOUSE_FILTER.PASS;
  root.add_child(card);
  card.position = { x: 100, y: 100 };
  card.size = { x: 300, y: 300 };
  const inner = button(card, 'Inner', 50, 50);
  const log = [];
  card.mouse_entered.connect(() => log.push('card+'));
  card.mouse_exited.connect(() => log.push('card-'));
  inner.mouse_entered.connect(() => log.push('inner+'));
  inner.mouse_exited.connect(() => log.push('inner-'));
  viewport.push(motion(170, 170));
  viewport.push(motion(300, 350));
  viewport.push(motion(1000, 800));
  // inner is STOP: over it, the chain is just inner; over the card, just the card (PASS, no parent).
  assert.deepEqual(log, ['inner+', 'inner-', 'card+', 'card-']);
});

test('a second mouse button never steals the control holding the first', () => {
  const { viewport, root } = stage();
  const a = button(root, 'A', 100, 100);
  const b = button(root, 'B', 300, 100);
  viewport.push(mouse(120, 110, true, MOUSE_BUTTON.LEFT));
  viewport.push(mouse(320, 110, true, MOUSE_BUTTON.RIGHT));
  assert.equal(viewport.mouseFocus, a, 'A keeps the mouse focus');
  viewport.push(mouse(320, 110, false, MOUSE_BUTTON.RIGHT));
  assert.equal(viewport.mouseFocus, a, 'still A: the left button is held');
  viewport.push(mouse(320, 110, false, MOUSE_BUTTON.LEFT));
  assert.equal(viewport.mouseFocus, null);
  assert.equal(b.log.includes('pressed'), false);
});

test('Tab order follows the tree and wraps inside the GUI root; Shift+Tab goes back', () => {
  const { viewport, root } = stage();
  const a = button(root, 'A', 100, 100);
  const group = new Control('Group');
  group.mouse_filter = MOUSE_FILTER.IGNORE;
  root.add_child(group);
  const b = button(group, 'B', 300, 100);
  const c = button(group, 'C', 500, 100);
  const hidden = button(root, 'Hidden', 700, 100);
  hidden.visible = false;
  a.grab_focus();
  viewport.push(key('Tab'));
  assert.equal(viewport.focusOwner, b);
  viewport.push(key('Tab'));
  assert.equal(viewport.focusOwner, c);
  viewport.push(key('Tab'));
  assert.equal(viewport.focusOwner, a, 'wrapped past the hidden button to the first');
  viewport.push(key('Tab', true, true));
  assert.equal(viewport.focusOwner, c, 'Shift+Tab: back to the last');
});

test('arrow keys pick the nearest control past the edge, ties toward the aligned one', () => {
  const { viewport, root } = stage();
  const centre = button(root, 'Centre', 400, 400);
  const right = button(root, 'Right', 600, 400);
  const farRight = button(root, 'FarRight', 900, 400);
  const below = button(root, 'Below', 400, 600);
  const diagonal = button(root, 'Diagonal', 600, 600);
  centre.grab_focus();
  viewport.push(key('ArrowRight'));
  assert.equal(viewport.focusOwner, right);
  viewport.push(key('ArrowRight'));
  assert.equal(viewport.focusOwner, farRight);
  centre.grab_focus();
  viewport.push(key('ArrowDown'));
  assert.equal(viewport.focusOwner, below, 'straight down beats the diagonal');
  assert.ok(diagonal);
});

test('with nothing focused, arrows and Tab focus nothing (the GUI lives under a CanvasLayer)', () => {
  const { viewport, root } = stage();
  button(root, 'A', 100, 100);
  viewport.push(key('Tab'));
  viewport.push(key('ArrowDown'));
  assert.equal(viewport.focusOwner, null);
});

test('hiding the hovered button sends mouse_exited and drops a press in progress', () => {
  const { viewport, root } = stage();
  const a = button(root, 'A', 100, 100);
  viewport.push(motion(120, 110));
  viewport.push(mouse(120, 110, true));
  a.visible = false;
  assert.equal(a.is_hovered(), false);
  assert.equal(a.is_pressing(), false);
  viewport.push(mouse(120, 110, false));
  assert.equal(a.log.includes('pressed'), false);
});

test('a button with FOCUS_NONE is pressed by a click but takes no focus', () => {
  const { viewport, root } = stage();
  const a = button(root, 'A', 100, 100);
  a.focus_mode = FOCUS.NONE;
  tap(viewport, 120, 110);
  assert.ok(a.log.includes('pressed'));
  assert.equal(viewport.focusOwner, null);
});

test('the tooltip is placed from where its wait began, flipped at the window edge', () => {
  const { viewport } = stage();
  viewport._tooltipPosition = { x: 1590, y: 890 };
  const at = viewport._tooltipPlacement({ x: 120, y: 30 });
  assert.deepEqual(at, { x: 1590 - 120 - 10, y: 890 - 30 - 10 });
  viewport._tooltipPosition = { x: 100, y: 100 };
  assert.deepEqual(viewport._tooltipPlacement({ x: 120, y: 30 }), { x: 110, y: 110 });
});
