/**
 * RelicView — port of scripts/presentation/relic_view.gd: a relic miniature on its dais at the
 * arena's rim; drops in with sparks and dust, hops and spins when it triggers, slides between spots,
 * sinks away when lost.
 */
import { Vector3, TAU } from '../godot/math.js';
import { Node3D } from '../godot/node3d.js';
import { TRANS, EASE } from '../godot/tween.js';
import { Settings } from '../autoload/settings.js';
import { Relics } from '../core/relics.js';
import { Palette } from './palette.js';
import { RelicModels, DAIS_TOP } from './relic_models.js';

const SCALE = 1.6;

export class RelicView extends Node3D {
  static SCALE = SCALE;

  constructor() {
    super('RelicView');
    this.id = '';
    this.spot = Vector3.ZERO;
    this.model = null;
    this._holder = null;
    this._tween = null;
    this._trigger_tween = null;
  }

  setup(relicId) {
    this.id = relicId;
    this.name = `Relic_${this.id}`;
    this._holder = new Node3D('Holder');
    this._holder.scale = Vector3.ONE.mul(SCALE);
    this.add_child(this._holder);
    this._holder.add_child(RelicModels.dais(String(Relics.info(this.id).rarity)));
    this.model = RelicModels.build(this.id);
    const position = this.model.position;
    position.y = DAIS_TOP;
    this.model.position = position;
    this._holder.add_child(this.model);
  }

  /** Where effects erupt from: the top of the relic. */
  top() {
    return this.global_position.add(Vector3.UP.mul(0.45 * SCALE));
  }

  drop_in(vfx, delay) {
    const rest = this.spot;
    this.position = rest.add(Vector3.UP.mul(1.8));
    this.scale = Vector3.ONE.mul(0.6);
    this.visible = false;
    this._restart();
    this._tween.tween_interval(delay);
    this._tween.tween_callback(() => this.show());
    this._tween.tween_property(this, 'position', rest, Settings.duration(0.5)).set_trans(TRANS.QUAD).set_ease(EASE.IN);
    this._tween.parallel().tween_property(this, 'scale', Vector3.ONE, Settings.duration(0.5));
    this._tween.tween_callback(() => {
      vfx.burst(this.global_position.add(Vector3.UP.mul(0.25)), Palette.GOLD_BRIGHT, 30, 2.4, 0.07);
      vfx.flash(this.global_position, Palette.GOLD_BRIGHT, 3.0, 0.6, 2.4);
      vfx.dust(this.global_position);
      this._holder.scale = new Vector3(1.18, 0.78, 1.18).mul(SCALE);
    });
    this._tween.tween_property(this._holder, 'scale', Vector3.ONE.mul(SCALE), 0.35).set_trans(TRANS.BACK).set_ease(EASE.OUT);
  }

  trigger(vfx, color) {
    if (this._trigger_tween) this._trigger_tween.kill();
    const position = this.model.position;
    position.y = DAIS_TOP;
    this.model.position = position;
    const rotation = this.model.rotation;
    rotation.y = 0.0;
    this.model.rotation = rotation;
    vfx.burst(this.top(), color, 20, 1.8, 0.06);
    vfx.flash(this.global_position, color, 2.6, 0.5, 2.2);
    this._trigger_tween = this.create_tween();
    const rise = Settings.duration(0.18);
    this._trigger_tween.tween_property(this.model, 'position:y', DAIS_TOP + 0.12, rise).set_trans(TRANS.QUAD).set_ease(EASE.OUT);
    if (!Settings.get_value('reduced_motion')) {
      this._trigger_tween.parallel().tween_property(this.model, 'rotation:y', TAU, Settings.duration(0.5)).set_trans(TRANS.CUBIC).set_ease(EASE.OUT);
    }
    this._trigger_tween.tween_property(this.model, 'position:y', DAIS_TOP, Settings.duration(0.32)).set_trans(TRANS.BOUNCE).set_ease(EASE.OUT);
    this._trigger_tween.tween_callback(() => {
      const r = this.model.rotation;
      r.y = 0.0;
      this.model.rotation = r;
    });
  }

  slide_to(to) {
    this.spot = to;
    this._restart();
    this._tween.tween_property(this, 'position', to, Settings.duration(0.45)).set_trans(TRANS.SINE).set_ease(EASE.IN_OUT);
  }

  place(at) {
    if (this._tween) this._tween.kill();
    this.spot = at;
    this.position = at;
    this.scale = Vector3.ONE;
    this.visible = true;
    this._holder.scale = Vector3.ONE.mul(SCALE);
  }

  sink() {
    this._restart();
    this._tween.tween_property(this, 'scale', new Vector3(0.01, 0.01, 0.01), Settings.duration(0.35)).set_trans(TRANS.BACK).set_ease(EASE.IN);
    this._tween.tween_callback(() => this.queue_free());
  }

  _restart() {
    if (this._tween) this._tween.kill();
    this._tween = this.create_tween();
  }
}
