/**
 * Keyboard focus navigation — Godot 4.7's Control::find_next_valid_focus, find_prev_valid_focus and
 * _get_focus_neighbor / _window_find_focus_neighbor (scene/gui/control.cpp), ported step for step:
 *
 *   next / prev   depth-first order through the Control tree, wrapping inside the subtree of the root
 *                 control (the first Control whose parent is not a Control: a CanvasLayer's child) or
 *                 across the Control children of a Window; the first control found with FOCUS_ALL
 *                 wins — disabled buttons included, as in the engine;
 *   neighbour     the closest FOCUS_ALL control beyond the current rect's far edge in the given
 *                 direction, measured between the rects (not their centres), ties broken toward the
 *                 control most aligned with the direction; a ScrollContainer that does not follow the
 *                 focus is searched on its own first.
 *
 * Every walk is O(controls) in the subtree it covers; a loop guard (the engine's `checked` set) keeps
 * pathological trees finite. Not ported, because the game sets none of them: explicit focus_next /
 * focus_previous / focus_neighbor paths, and ScrollContainers that follow the focus.
 */
import { CanvasLayer } from './canvas_item.js';
import { Control, FOCUS } from './control.js';
import { Container } from './containers.js';

export const SIDE = Object.freeze({ LEFT: 0, TOP: 1, RIGHT: 2, BOTTOM: 3 });
/** Control::_get_focus_neighbor's search limit through focus_neighbor paths. */
const MAX_NEIGHBOR_SEARCH_COUNT = 512;
const DIRECTIONS = Object.freeze([
  { x: -1, y: 0 },
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
]);
const CMP_EPSILON = 0.00001;
const FAR = 1e7;

const isTopLevel = (control) => control.top_level === true;
const isWindowLike = (node) => node?.isWindow === true;
const focusable = (control) => control.focus_mode === FOCUS.ALL;

/** Children that are Controls, visible in the tree and not top level (the traversal's candidates). */
const walkable = (node) => node instanceof Control && node.is_visible_in_tree() && !isTopLevel(node);

/** Control.data.RI: a root of the GUI (its parent is not a Control — a CanvasLayer or the viewport). */
const isGuiRoot = (control) => !(control.parent instanceof Control);

/** The index of `node` among its parent's children (internal ones included, as the engine counts). */
const indexOf = (node) => node.parent.children.indexOf(node);

/** _next_control: the next sibling in tree order, climbing parents when a level is exhausted. */
function nextControl(from) {
  if (isTopLevel(from)) return null;
  const parent = from.get_parent_control();
  if (!parent) return null;
  const siblings = parent.children;
  for (let i = indexOf(from) + 1; i < siblings.length; i++) if (walkable(siblings[i])) return siblings[i];
  return nextControl(parent);
}

/** _prev_control: the deepest last descendant (the control itself when it has none). */
function prevControl(from) {
  for (let i = from.children.length - 1; i >= 0; i--) {
    const child = from.children[i];
    if (walkable(child)) return prevControl(child);
  }
  return from;
}

/** Control::find_next_valid_focus. */
export function findNextValidFocus(start) {
  let from = start;
  const checked = new Set([from]);
  let windowNext = -1;
  for (;;) {
    let next = from.children.find(walkable) ?? null;
    if (!next) {
      next = nextControl(from);
      if (!next) {
        // Nothing further down: back to the root of this GUI subtree (or its window, and on).
        next = start;
        while (next) {
          if (isTopLevel(next) || isGuiRoot(next)) break;
          next = next.get_parent_control();
        }
        const window = next && isWindowLike(next.parent) ? next.parent : null;
        if (window) {
          if (windowNext === -1) windowNext = indexOf(next);
          const count = window.children.length;
          for (let i = 1; i < count + 1; i++) {
            const at = (((windowNext + i) % count) + count) % count;
            const candidate = window.children[at];
            if (!walkable(candidate)) continue;
            windowNext = at;
            next = candidate;
            break;
          }
        }
      }
    }
    if (!next) return null;
    if (focusable(next)) return next;
    if (checked.has(next)) return null;
    checked.add(next);
    from = next;
  }
}

/** Control::find_prev_valid_focus. */
export function findPrevValidFocus(start) {
  let from = start;
  const checked = new Set([from]);
  let windowPrev = -1;
  for (;;) {
    let prev = null;
    if (isTopLevel(from) || !(from.parent instanceof Control)) {
      const window = isWindowLike(from.parent) ? from.parent : null;
      if (window) {
        if (windowPrev === -1) windowPrev = indexOf(from);
        const count = window.children.length;
        for (let i = 1; i < count + 1; i++) {
          const at = (((windowPrev - i) % count) + count) % count;
          const candidate = window.children[at];
          if (!walkable(candidate)) continue;
          windowPrev = at;
          prev = prevControl(candidate);
          break;
        }
      }
      if (!prev) prev = prevControl(from);
    } else {
      const siblings = from.parent.children;
      for (let i = indexOf(from) - 1; i >= 0; i--) {
        if (!walkable(siblings[i])) continue;
        prev = siblings[i];
        break;
      }
      prev = prev ? prevControl(prev) : from.get_parent_control();
    }
    if (focusable(prev)) return prev;
    if (checked.has(prev)) return null;
    checked.add(prev);
    from = prev;
  }
}

// ─────────────────────────────────────────────────────────────── geometry ─────────────────────────

const rectOf = (control) => {
  const r = control.get_global_rect();
  return { x: r.x, y: r.y, w: r.w, h: r.h };
};
const dot = (d, x, y) => d.x * x + d.y * y;
const centreOf = (r) => ({ x: r.x + r.w * 0.5, y: r.y + r.h * 0.5 });
const hasArea = (r) => r.w > 0 && r.h > 0;

/** Rect2::intersects (touching edges do not count). */
function intersects(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Rect2::intersection (an empty rect when they do not overlap). */
function intersection(a, b) {
  if (!intersects(a, b)) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return { x, y, w: Math.min(a.x + a.w, b.x + b.w) - x, h: Math.min(a.y + a.h, b.y + b.h) - y };
}

const isScrollContainer = (node) => node?.constructor?.themeType === 'ScrollContainer';
const followsFocus = (scroll) => scroll.follow_focus === true;
const isAncestorOf = (ancestor, node) => {
  for (let n = node.parent; n; n = n.parent) if (n === ancestor) return true;
  return false;
};

/**
 * Control::_window_find_focus_neighbor: the closest candidate in the subtree at `at`. `search`
 * carries the running best ({ closest, distanceSquared }). O(subtree).
 */
function findNeighborIn(self, direction, at, rect, clamp, min, search) {
  if (at instanceof CanvasLayer || isWindowLike(at)) return;
  const control = at instanceof Control ? at : null;
  const inContainer = control instanceof Container && isAncestorOf(control, self);
  if (control && control !== self && focusable(control) && !inContainer && intersects(clamp, rectOf(control))) {
    const candidate = intersection(rectOf(control), clamp);
    const max = Math.max(dot(direction, candidate.x, candidate.y), dot(direction, candidate.x + candidate.w, candidate.y + candidate.h));
    // Use max to allow navigation to overlapping controls (the ScrollContainer case).
    if (max > min + CMP_EPSILON) {
      const origin = { x: centreOf(candidate).x - centreOf(rect).x, y: centreOf(candidate).y - centreOf(rect).y };
      // Folded into the first quadrant: the gap between the rects along each axis.
      const gapX = Math.abs(origin.x) - 0.5 * candidate.w - 0.5 * rect.w;
      const gapY = Math.abs(origin.y) - 0.5 * candidate.h - 0.5 * rect.h;
      let distanceSquared = 0;
      if (gapX > 0) distanceSquared += gapX * gapX;
      if (gapY > 0) distanceSquared += gapY * gapY;
      if (distanceSquared < search.distanceSquared || search.closest === null) {
        search.distanceSquared = distanceSquared;
        search.closest = control;
      } else if (distanceSquared === search.distanceSquared) {
        // Tie: the control most aligned with the direction (Vector2::cross).
        const from = centreOf(rect);
        const best = centreOf(rectOf(search.closest));
        const cross = (v) => direction.x * v.y - direction.y * v.x;
        if (Math.abs(cross(origin)) < Math.abs(cross({ x: best.x - from.x, y: best.y - from.y }))) search.closest = control;
      }
    }
  }
  let limit = clamp;
  if (control && isScrollContainer(control) && (!followsFocus(control) || !inContainer)) {
    limit = intersection(clamp, rectOf(control));
    if (!hasArea(limit)) return;
  }
  for (const child of at.children) {
    if (child instanceof Control) {
      if (isGuiRoot(child)) continue; // another GUI root (a subwindow, for the engine)
      if (!child.is_visible_in_tree()) continue;
      if (isScrollContainer(child) && isAncestorOf(child, self)) continue;
    }
    findNeighborIn(self, direction, child, rect, limit, min, search);
  }
}

/** Control::_get_focus_neighbor(side). */
export function focusNeighbor(self, side, count = 0) {
  if (count >= MAX_NEIGHBOR_SEARCH_COUNT) return null;
  const direction = DIRECTIONS[side];
  const rect = rectOf(self);
  let maxd = Math.max(dot(direction, rect.x, rect.y), dot(direction, rect.x + rect.w, rect.y + rect.h));
  const clamp = { x: -FAR, y: -FAR, w: 2 * FAR, h: 2 * FAR };
  const search = { closest: null, distanceSquared: 1e14 };
  let resultRect = null;
  let base = self;
  while (base) {
    if (isScrollContainer(base)) {
      const scrollRect = rectOf(base);
      const follow = followsFocus(base);
      if (search.closest && !follow && !intersects(scrollRect, resultRect)) search.closest = null;
      if (search.closest === null) {
        const begin = dot(direction, scrollRect.x, scrollRect.y);
        const end = dot(direction, scrollRect.x + scrollRect.w, scrollRect.y + scrollRect.h);
        const scrollMax = Math.max(begin, end);
        const scrollMin = Math.min(begin, end);
        if (!follow && maxd < scrollMin) {
          // Reposition to find a visible control (the engine moves by the updated difference: zero).
          maxd = scrollMin;
        }
        if (follow || scrollMax > maxd) findNeighborIn(self, direction, base, rect, clamp, maxd, search);
        if (search.closest === null) maxd = scrollMax;
        else resultRect = rectOf(search.closest);
      }
    }
    if (base instanceof Control && isGuiRoot(base)) break;
    base = base.parent;
  }
  if (search.closest) return search.closest;
  if (!base) return null;
  findNeighborIn(self, direction, base, rect, clamp, maxd, search);
  return search.closest;
}
