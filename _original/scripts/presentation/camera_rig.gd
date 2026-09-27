class_name CameraRig
extends Node3D




const DEFAULT_YAW: = 0.42
const DEFAULT_PITCH: = 0.93
const YAW_RANGE: = 1.2
const PITCH_MIN: = 0.62
const PITCH_MAX: = 1.3
const ZOOM_MIN: = 0.72
const ZOOM_MAX: = 1.3

var camera: Camera3D
var input_enabled: = true
var idle_orbit: = false

var safe_left: = -0.9
var safe_right: = 0.9
var safe_bottom: = -0.58
var safe_top: = 0.78

var yaw: = DEFAULT_YAW
var pitch: = DEFAULT_PITCH
var zoom: = 1.0
var target_yaw: = DEFAULT_YAW
var target_pitch: = DEFAULT_PITCH
var target_zoom: = 1.0
var focus: = Vector3.ZERO
var target_focus: = Vector3.ZERO
var trauma: = 0.0

var _dragging: = false
var _noise: = FastNoiseLite.new()
var _time: = 0.0
var _bounds: Array[Vector3] = []


func _ready() -> void :
	camera = Camera3D.new()
	camera.fov = 34.0
	camera.near = 0.2
	camera.far = 120.0
	add_child(camera)
	camera.make_current()
	_noise.seed = 11
	_noise.frequency = 2.2
	for x in [-1.0, 1.0]:
		for z in [-1.0, 1.0]:
			_bounds.append(Vector3(x * 3.45, -0.05, z * 3.45))
			_bounds.append(Vector3(x * 2.9, 1.25, z * 2.9))
	_update(0.0, true)


func _process(delta: float) -> void :
	_update(delta, false)



func set_safe_area(left: float, right: float, bottom: float, top: float) -> void :
	assert (left < 0.0 and right > 0.0 and bottom < 0.0 and top > 0.0, "the safe area must contain the screen centre")
	safe_left = left
	safe_right = right
	safe_bottom = bottom
	safe_top = top




func frame_board() -> void :
	set_safe_area(-0.62, 0.62, -0.76, 0.84)


func reset_view() -> void :
	target_yaw = DEFAULT_YAW
	target_pitch = DEFAULT_PITCH
	target_zoom = 1.0


func add_trauma(amount: float) -> void :
	trauma = minf(1.0, trauma + amount * Settings.shake_scale())



func push_focus(point: Vector3, zoom_factor: = 0.9, weight: = 0.35) -> void :
	target_focus = Vector3(point.x, 0.0, point.z) * weight
	target_zoom = zoom_factor


func release_focus() -> void :
	target_focus = Vector3.ZERO
	target_zoom = 1.0


func orbit(amount: float) -> void :
	target_yaw = clampf(target_yaw + amount, DEFAULT_YAW - YAW_RANGE, DEFAULT_YAW + YAW_RANGE)


func _unhandled_input(event: InputEvent) -> void :
	if not input_enabled:
		return
	if event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_RIGHT:
			_dragging = event.pressed
		elif event.pressed and event.button_index == MOUSE_BUTTON_WHEEL_UP:
			target_zoom = clampf(target_zoom * 0.92, ZOOM_MIN, ZOOM_MAX)
		elif event.pressed and event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			target_zoom = clampf(target_zoom / 0.92, ZOOM_MIN, ZOOM_MAX)
		elif event.pressed and event.button_index == MOUSE_BUTTON_MIDDLE:
			reset_view()
	elif event is InputEventMouseMotion and _dragging:
		orbit( - event.relative.x * 0.006)
		target_pitch = clampf(target_pitch + event.relative.y * 0.004, PITCH_MIN, PITCH_MAX)
	elif event.is_action_pressed("camera_left"):
		orbit(0.35)
	elif event.is_action_pressed("camera_right"):
		orbit(-0.35)
	elif event.is_action_pressed("camera_reset"):
		reset_view()


func is_dragging() -> bool:
	return _dragging


func _update(delta: float, snap: bool) -> void :
	_time += delta
	if idle_orbit:
		target_yaw += delta * 0.06
	var blend: = 1.0 if snap else 1.0 - exp( - delta * 6.0)
	yaw = lerpf(yaw, target_yaw, blend)
	pitch = lerpf(pitch, target_pitch, blend)
	zoom = lerpf(zoom, target_zoom, blend)
	focus = focus.lerp(target_focus, blend)

	var size: = get_viewport().get_visible_rect().size
	var aspect: = size.x / maxf(size.y, 1.0)
	var back: = Vector3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch))
	var forward: = - back
	var right: = forward.cross(Vector3.UP).normalized()
	var up: = right.cross(forward).normalized()
	var tan_v: = tan(deg_to_rad(camera.fov) * 0.5)
	var tan_h: = tan_v * aspect


	var distance: = _fit(right, up, forward, tan_h, tan_v)
	var shift: = 0.0
	var slide: = 0.0
	for _i in 4:
		var low: = INF
		var high: = - INF
		var left_edge: = INF
		var right_edge: = - INF
		for point in _bounds:
			var depth: = point.dot(forward) + distance
			var ndc_y: = (point.dot(up) + shift) / (depth * tan_v)
			var ndc_x: = (point.dot(right) + slide) / (depth * tan_h)
			low = minf(low, ndc_y)
			high = maxf(high, ndc_y)
			left_edge = minf(left_edge, ndc_x)
			right_edge = maxf(right_edge, ndc_x)
		shift += ((safe_top + safe_bottom) * 0.5 - (high + low) * 0.5) * tan_v * distance * 0.9
		slide += ((safe_right + safe_left) * 0.5 - (right_edge + left_edge) * 0.5) * tan_h * distance * 0.9
	distance *= zoom

	var eye: = focus + back * distance - up * shift - right * slide
	var look: = focus - up * shift - right * slide
	trauma = maxf(0.0, trauma - delta * 1.6)
	var shake: = trauma * trauma
	if shake > 0.0001:
		var t: = _time * 30.0
		eye += (right * _noise.get_noise_2d(t, 0.0) + up * _noise.get_noise_2d(0.0, t)) * shake * 0.35
	camera.global_position = eye
	camera.look_at(look, Vector3.UP)
	if shake > 0.0001:
		camera.rotate_object_local(Vector3.FORWARD, _noise.get_noise_2d(_time * 25.0, 99.0) * shake * 0.04)



func _fit(right: Vector3, up: Vector3, forward: Vector3, tan_h: float, tan_v: float) -> float:
	var half_w: = (safe_right - safe_left) * 0.5
	var half_h: = (safe_top - safe_bottom) * 0.5
	var x_range: = Vector2(INF, - INF)
	var y_range: = Vector2(INF, - INF)
	for point in _bounds:
		x_range = Vector2(minf(x_range.x, point.dot(right)), maxf(x_range.y, point.dot(right)))
		y_range = Vector2(minf(y_range.x, point.dot(up)), maxf(y_range.y, point.dot(up)))
	var centre: = Vector2((x_range.x + x_range.y) * 0.5, (y_range.x + y_range.y) * 0.5)
	var needed: = 0.0
	for point in _bounds:
		var z: = point.dot(forward)
		needed = maxf(needed, absf(point.dot(right) - centre.x) / (half_w * tan_h) - z)
		needed = maxf(needed, absf(point.dot(up) - centre.y) / (half_h * tan_v) - z)
	return maxf(needed, 4.0)
