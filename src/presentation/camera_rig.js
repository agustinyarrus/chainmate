/**
 * CameraRig — port of scripts/presentation/camera_rig.gd: an orbiting camera that fits the arena
 * into a "safe area" of the screen (so UI panels never cover the board) at any aspect ratio, with
 * eased yaw/pitch/zoom/focus, idle orbit and trauma-based shake (FastNoiseLite, seed 11).
 *
 * The fit runs 4 fixed-point iterations of an NDC-centering solve over 8 bounding points — O(1).
 */
import { Vector2, Vector3, lerpf, clampf, deg_to_rad } from '../godot/math.js';
import { Node3D, Camera3D } from '../godot/node3d.js';
import { FastNoiseLite } from '../godot/noise.js';
import { MOUSE_BUTTON } from '../godot/input.js';
import { Settings } from '../autoload/settings.js';

const DEFAULT_YAW = 0.42;
const DEFAULT_PITCH = 0.93;
const YAW_RANGE = 1.2;
const PITCH_MIN = 0.62;
const PITCH_MAX = 1.3;
const ZOOM_MIN = 0.72;
const ZOOM_MAX = 1.3;

export class CameraRig extends Node3D {
  static DEFAULT_YAW = DEFAULT_YAW;
  static DEFAULT_PITCH = DEFAULT_PITCH;

  constructor() {
    super('CameraRig');
    this.camera = null;
    this.input_enabled = true;
    this.idle_orbit = false;
    this.safe_left = -0.9;
    this.safe_right = 0.9;
    this.safe_bottom = -0.58;
    this.safe_top = 0.78;
    this.yaw = DEFAULT_YAW;
    this.pitch = DEFAULT_PITCH;
    this.zoom = 1.0;
    this.target_yaw = DEFAULT_YAW;
    this.target_pitch = DEFAULT_PITCH;
    this.target_zoom = 1.0;
    this.focus = Vector3.ZERO;
    this.target_focus = Vector3.ZERO;
    this.trauma = 0.0;
    this._dragging = false;
    this._noise = new FastNoiseLite();
    this._time = 0.0;
    this._bounds = [];
    /** Viewport size in logical pixels, provided by the app (aspect only matters). */
    this.viewportSize = () => new Vector2(1600, 900);
  }

  _ready() {
    this.camera = new Camera3D();
    this.camera.fov = 34.0;
    this.camera.near = 0.2;
    this.camera.far = 120.0;
    this.add_child(this.camera);
    this._noise.seed = 11;
    this._noise.frequency = 2.2;
    for (const x of [-1.0, 1.0]) {
      for (const z of [-1.0, 1.0]) {
        this._bounds.push(new Vector3(x * 3.45, -0.05, z * 3.45));
        this._bounds.push(new Vector3(x * 2.9, 1.25, z * 2.9));
      }
    }
    this._update(0.0, true);
  }

  _process(delta) {
    this._update(delta, false);
  }

  set_safe_area(left, right, bottom, top) {
    if (!(left < 0.0 && right > 0.0 && bottom < 0.0 && top > 0.0)) throw new Error('the safe area must contain the screen centre');
    this.safe_left = left;
    this.safe_right = right;
    this.safe_bottom = bottom;
    this.safe_top = top;
  }

  frame_board() {
    this.set_safe_area(-0.62, 0.62, -0.76, 0.84);
  }

  reset_view() {
    this.target_yaw = DEFAULT_YAW;
    this.target_pitch = DEFAULT_PITCH;
    this.target_zoom = 1.0;
  }

  add_trauma(amount) {
    this.trauma = Math.min(1.0, this.trauma + amount * Settings.shake_scale());
  }

  push_focus(point, zoomFactor = 0.9, weight = 0.35) {
    this.target_focus = new Vector3(point.x, 0.0, point.z).mul(weight);
    this.target_zoom = zoomFactor;
  }

  release_focus() {
    this.target_focus = Vector3.ZERO;
    this.target_zoom = 1.0;
  }

  orbit(amount) {
    this.target_yaw = clampf(this.target_yaw + amount, DEFAULT_YAW - YAW_RANGE, DEFAULT_YAW + YAW_RANGE);
  }

  _unhandled_input(event) {
    if (!this.input_enabled) return;
    if (event.kind === 'mouse_button') {
      if (event.button_index === MOUSE_BUTTON.RIGHT) this._dragging = event.pressed;
      else if (event.pressed && event.button_index === MOUSE_BUTTON.WHEEL_UP) this.target_zoom = clampf(this.target_zoom * 0.92, ZOOM_MIN, ZOOM_MAX);
      else if (event.pressed && event.button_index === MOUSE_BUTTON.WHEEL_DOWN) this.target_zoom = clampf(this.target_zoom / 0.92, ZOOM_MIN, ZOOM_MAX);
      else if (event.pressed && event.button_index === MOUSE_BUTTON.MIDDLE) this.reset_view();
    } else if (event.kind === 'mouse_motion' && this._dragging) {
      this.orbit(-event.relative.x * 0.006);
      this.target_pitch = clampf(this.target_pitch + event.relative.y * 0.004, PITCH_MIN, PITCH_MAX);
    } else if (event.is_action_pressed('camera_left')) {
      this.orbit(0.35);
    } else if (event.is_action_pressed('camera_right')) {
      this.orbit(-0.35);
    } else if (event.is_action_pressed('camera_reset')) {
      this.reset_view();
    }
  }

  is_dragging() {
    return this._dragging;
  }

  _update(delta, snap) {
    this._time += delta;
    if (this.idle_orbit) this.target_yaw += delta * 0.06;
    const blend = snap ? 1.0 : 1.0 - Math.exp(-delta * 6.0);
    this.yaw = lerpf(this.yaw, this.target_yaw, blend);
    this.pitch = lerpf(this.pitch, this.target_pitch, blend);
    this.zoom = lerpf(this.zoom, this.target_zoom, blend);
    this.focus = this.focus.lerp(this.target_focus, blend);

    const size = this.viewportSize();
    const aspect = size.x / Math.max(size.y, 1.0);
    const back = new Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    const forward = back.neg();
    const right = forward.cross(Vector3.UP).normalized();
    const up = right.cross(forward).normalized();
    const tanV = Math.tan(deg_to_rad(this.camera.fov) * 0.5);
    const tanH = tanV * aspect;

    let distance = this._fit(right, up, forward, tanH, tanV);
    let shift = 0.0;
    let slide = 0.0;
    for (let i = 0; i < 4; i++) {
      let low = Infinity;
      let high = -Infinity;
      let leftEdge = Infinity;
      let rightEdge = -Infinity;
      for (const point of this._bounds) {
        const depth = point.dot(forward) + distance;
        const ndcY = (point.dot(up) + shift) / (depth * tanV);
        const ndcX = (point.dot(right) + slide) / (depth * tanH);
        low = Math.min(low, ndcY);
        high = Math.max(high, ndcY);
        leftEdge = Math.min(leftEdge, ndcX);
        rightEdge = Math.max(rightEdge, ndcX);
      }
      shift += ((this.safe_top + this.safe_bottom) * 0.5 - (high + low) * 0.5) * tanV * distance * 0.9;
      slide += ((this.safe_right + this.safe_left) * 0.5 - (rightEdge + leftEdge) * 0.5) * tanH * distance * 0.9;
    }
    distance *= this.zoom;

    let eye = this.focus.add(back.mul(distance)).sub(up.mul(shift)).sub(right.mul(slide));
    const look = this.focus.sub(up.mul(shift)).sub(right.mul(slide));
    this.trauma = Math.max(0.0, this.trauma - delta * 1.6);
    const shake = this.trauma * this.trauma;
    if (shake > 0.0001) {
      const t = this._time * 30.0;
      eye = eye.add(right.mul(this._noise.get_noise_2d(t, 0.0)).add(up.mul(this._noise.get_noise_2d(0.0, t))).mul(shake).mul(0.35));
    }
    this.camera.global_position = eye;
    this.camera.look_at(look, Vector3.UP);
    if (shake > 0.0001) this.camera.rotate_object_local(Vector3.FORWARD, this._noise.get_noise_2d(this._time * 25.0, 99.0) * shake * 0.04);
  }

  /** Smallest distance at which all bounding points fit the safe area (at least 4). */
  _fit(right, up, forward, tanH, tanV) {
    const halfW = (this.safe_right - this.safe_left) * 0.5;
    const halfH = (this.safe_top - this.safe_bottom) * 0.5;
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const point of this._bounds) {
      xMin = Math.min(xMin, point.dot(right));
      xMax = Math.max(xMax, point.dot(right));
      yMin = Math.min(yMin, point.dot(up));
      yMax = Math.max(yMax, point.dot(up));
    }
    const centreX = Math.fround((xMin + xMax) * 0.5);
    const centreY = Math.fround((yMin + yMax) * 0.5);
    let needed = 0.0;
    for (const point of this._bounds) {
      const z = point.dot(forward);
      needed = Math.max(needed, Math.abs(point.dot(right) - centreX) / (halfW * tanH) - z);
      needed = Math.max(needed, Math.abs(point.dot(up) - centreY) / (halfH * tanV) - z);
    }
    return Math.max(needed, 4.0);
  }
}
