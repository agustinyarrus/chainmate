/**
 * trace — the port's half of the state trace behind the capture tours (the original's half is
 * _oracle/probe_tour.gd --trace; tools/trace-compare.mjs lines the two up).
 *
 * At the start of every frame (process_frame, before any _process — where the probe awaits it) it
 * prints, in the probe's exact format:
 *
 *   TRACE draw frame=F kind=K path=P value=V  every holder of a draw of the global stream the frame it
 *                                             appears, in find_children's preorder: cloth `phase`,
 *                                             flame `seed`, particle seeds (again after a reseed)
 *   TRACE gui frame=F what=hover|focus control=C
 *                                             the hovered control or the focus owner, when it changes:
 *                                             its child indices under Main (internal children left
 *                                             out) and its text
 *   TRACE spawn frame=F id=ID time=T          a piece view the first frame it is seen; its idle phase
 *                                             `_time` is a draw of the global random stream, so the
 *                                             sequence of these is a fingerprint of the stream
 *   TRACE shot frame=F index=N                the autopilot took shot N during the previous frame
 *   TRACE halo id=ID time=T turn=R height=H seed=S
 *                                             every halo as that shot drew it
 *
 * `?trace` turns it on (with `?capture`). O(pieces) per frame; nothing is allocated when idle.
 */

/** `%.Nf` like GDScript's String formatting (correctly rounded decimals). */
const fixed = (value, decimals) => value.toFixed(decimals);

/** A GPUParticles3D, recognised by duck type to keep this module standalone. */
const isParticles = (node) => typeof node.seed === 'number' && 'process_material' in node;

/** The GPUParticles3D under a halo (its sparks). */
function sparksOf(halo) {
  return halo.children.find(isParticles) ?? null;
}

/** The shaders whose parameter is a draw of the global stream (arena_props), and that parameter. */
const DRAWN_PARAMETERS = new Map([['cloth', 'phase'], ['flame', 'seed']]);
/**
 * The web export's shader warm-up (Main._warm_up_shaders, Vfx.warm_up): the shipped desktop build
 * never builds it and the port builds it outside the global stream, so its draws are not the stream's.
 */
const WARM_UP_NODES = new Set(['ShaderWarmUp', 'WarmUp', 'WarmUpBurst']);

/** Node.find_children's order: each child, then its own descendants, then the next child. O(n). */
function* preorder(node, path = '') {
  for (const child of node.children) {
    if (WARM_UP_NODES.has(child.name)) continue;
    const childPath = path ? `${path}/${child.name}` : child.name;
    yield [child, childPath];
    yield* preorder(child, childPath);
  }
}

/** A child's index among its parent's children, internal ones left out (−1 for an internal child). */
const childIndex = (node) => node.parent.children.filter((child) => !child._internal).indexOf(node);

/** The probe's `_describe`: child indices from Main down to the control, then its text. O(depth × siblings). */
function describe(control, main) {
  if (!control) return '-';
  const steps = [];
  for (let node = control; node && node !== main; node = node.parent) steps.unshift(node.parent ? String(childIndex(node)) : '0');
  const text = typeof control.text === 'string' ? control.text.trim() : '';
  return `${steps.join('/')}:${text.replace(/[ \n]/g, '_')}`;
}

/**
 * Installs the tracer. `main` is the Main scene (it owns pieces_root), `viewport` the GUI viewport
 * (hover and focus), `isAutopilot` recognises the tour's driver among main's children, `log`
 * receives each line. O(1).
 */
export function installTrace(tree, main, viewport, isAutopilot, log) {
  let frame = 0;
  let lastShot = -1;
  const seen = new WeakSet();
  const lastGui = { hover: '', focus: '' };
  // Every control the mouse enters, at that very moment (inside the input event, before any deferred
  // layout), like the probe's mouse_entered hook: its global rect, and its siblings' for the hovered one.
  const isControl = (node) => node && 'mouse_filter' in node && typeof node.get_global_rect === 'function';
  const rect = (control) => {
    const r = control.get_global_rect();
    return `${fixed(r.x, 1)},${fixed(r.y, 1)},${fixed(r.w, 1)},${fixed(r.h, 1)}`;
  };
  const updateMouseOver = viewport._updateMouseOver.bind(viewport);
  viewport._updateMouseOver = (point) => {
    const before = new Set(viewport.hoverHierarchy);
    updateMouseOver(point);
    for (const control of viewport.hoverHierarchy) {
      if (before.has(control)) continue;
      log(`TRACE enter frame=${frame} control=${describe(control, main)} rect=${rect(control)}`);
      if (control !== viewport.mouseOver || !control.parent) continue;
      for (const sibling of control.parent.children) if (isControl(sibling)) log(`TRACE sibling frame=${frame} control=${describe(sibling, main)} rect=${rect(sibling)}`);
    }
  };
  const traceGui = () => {
    for (const [what, control] of [['hover', viewport.mouseOver], ['focus', viewport.focusOwner]]) {
      const described = describe(control, main);
      if (described === lastGui[what]) continue;
      lastGui[what] = described;
      log(`TRACE gui frame=${frame} what=${what} control=${described}`);
    }
  };
  /** node → the drawn values already printed for it (a particle system reseeds). */
  const drawn = new WeakMap();
  const traceDraws = () => {
    for (const [node, path] of preorder(main)) {
      let value = null;
      let kind = null;
      if (isParticles(node)) {
        kind = 'particles';
        value = node.seed;
      } else {
        const material = node.material_override;
        const parameter = material?.spec ? DRAWN_PARAMETERS.get(material.spec.name) : undefined;
        if (!parameter) continue;
        kind = parameter;
        value = material.get_shader_parameter(parameter);
      }
      const printed = drawn.get(node) ?? new Set();
      const key = kind === 'particles' ? value : kind;
      if (printed.has(key)) continue;
      printed.add(key);
      drawn.set(node, printed);
      log(`TRACE draw frame=${frame} kind=${kind} path=${path} value=${kind === 'particles' ? value : fixed(value, 12)}`);
    }
  };
  tree.process_frame.connect(() => {
    frame += 1;
    const pilot = main.children.find(isAutopilot);
    if (!pilot || !main.pieces_root) return;
    traceDraws();
    traceGui();
    const views = main.pieces_root.children;
    for (const view of views) {
      if (seen.has(view)) continue;
      seen.add(view);
      log(`TRACE spawn frame=${frame} id=${view.piece_id} time=${fixed(view._time, 12)}`);
    }
    if (pilot._index === lastShot) return;
    lastShot = pilot._index;
    log(`TRACE shot frame=${frame} index=${pilot._index}`);
    for (const view of views) {
      if (!view._halo || view.is_queued_for_deletion()) continue;
      const sparks = sparksOf(view._halo);
      log(`TRACE halo id=${view.piece_id} time=${fixed(view._time, 12)} turn=${fixed(view._halo.rotation.y, 9)} height=${fixed(view._halo.position.y, 9)} seed=${sparks?.seed ?? -1}`);
    }
  });
}
