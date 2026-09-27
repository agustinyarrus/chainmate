class_name Arena
extends Node3D





const VARIANTS: PackedStringArray = ["outpost", "crypt", "court"]
const RIM_IN: = 3.05
const WALL_DEPTH: = 0.5
const RIM_OUT: = RIM_IN + WALL_DEPTH
const COURSE: = 0.4
const RIM_BASE: = -0.08
const SKIN_COURSES: = 7
const TILE_SIZE: = 0.965
const TILE_HEIGHT: = 0.16
const SIDES: Array[Vector3] = [Vector3(0, 0, -1), Vector3(1, 0, 0), Vector3(0, 0, 1), Vector3(-1, 0, 0)]

var environment: Environment

var variant: = ""
var _world: WorldEnvironment
var _sky_material: ShaderMaterial
var _key: DirectionalLight3D
var _fill: DirectionalLight3D
var _content: Node3D
var _look: Dictionary = {}
var _rng: = RandomNumberGenerator.new()
var _materials: Dictionary = {}
var _blocks: Dictionary = {}
var _flames: Array[Dictionary] = []
var _tops: Array = []
var _leaves: Dictionary = {}
var _mood: = Vector2(1.0, 0.0)
var _mood_tween: Tween
var _flicker_time: = 0.0

static var _kit: Dictionary = {}
static var _shaders: Dictionary = {}
static var _tile: ArrayMesh




func _init() -> void :
	environment = Environment.new()
	_sky_material = ShaderMaterial.new()
	_sky_material.shader = _shader("sky", SKY_SHADER)
	var sky: = Sky.new()
	sky.sky_material = _sky_material
	sky.radiance_size = Sky.RADIANCE_SIZE_64
	environment.sky = sky
	_world = WorldEnvironment.new()
	_world.environment = environment
	add_child(_world)
	_key = DirectionalLight3D.new()
	_key.shadow_enabled = true
	_key.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	_key.directional_shadow_max_distance = 32.0
	_key.shadow_blur = 1.2
	_key.shadow_normal_bias = 1.2
	add_child(_key)
	_fill = DirectionalLight3D.new()
	_fill.shadow_enabled = false
	_fill.light_volumetric_fog_energy = 0.0
	add_child(_fill)


func _ready() -> void :
	if variant == "":
		set_variant("outpost")


func _process(delta: float) -> void :
	_flicker_time += delta
	var mood_scale: = _flame_mood()
	for flame in _flames:
		var light: Light3D = flame.light
		var t: float = _flicker_time * float(flame.speed) + float(flame.phase)
		var n: = sin(t * 7.1) * 0.45 + sin(t * 13.3 + 1.3) * 0.3 + sin(t * 23.7 + 0.4) * 0.25
		light.light_energy = float(flame.energy) * mood_scale * (1.0 + n * float(flame.flicker))



func set_variant(new_variant: String) -> void :
	assert (VARIANTS.has(new_variant), "Unknown arena variant: %s" % new_variant)
	variant = new_variant
	if _content:
		remove_child(_content)
		_content.queue_free()
	_content = Node3D.new()
	_content.name = "Arena_" + variant
	add_child(_content)
	_flames.clear()
	_blocks.clear()
	_tops.clear()
	_leaves = {0: [], 1: [], 2: []}
	_materials.clear()
	_look = _looks()[variant]
	_rng.seed = hash("arena-" + variant)
	_apply_environment()
	_build_materials()
	_build_platform()
	match variant:
		"outpost":
			_dress_outpost()
		"crypt":
			_dress_crypt()
		"court":
			_dress_court()
	_flush_blocks()
	_flush_leaves()
	_apply_mood(_mood)



func set_mood(level: float, warmth: = 0.0, duration: = 1.0) -> void :
	if _mood_tween:
		_mood_tween.kill()
	var target: = Vector2(level, clampf(warmth, 0.0, 1.0))
	if duration <= 0.02:
		_apply_mood(target)
		return
	_mood_tween = create_tween().set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	_mood_tween.tween_method(_apply_mood, _mood, target, duration)



static func tile_mesh() -> ArrayMesh:
	if _tile == null:
		var chips: Array[Dictionary] = [
			{"dir": Vector3(0.62, 0.7, 0.36), "depth": 0.03, "at": Vector3(0.4825, 0.08, 0.4825)}, 
			{"dir": Vector3(-0.3, 0.72, -0.62), "depth": 0.026, "at": Vector3(-0.4825, 0.08, -0.4825)}, 
			{"dir": Vector3(-0.75, 0.66, 0.05), "depth": 0.018, "at": Vector3(-0.4825, 0.08, 0.12)}, 
			{"dir": Vector3(0.08, 0.7, -0.71), "depth": 0.014, "at": Vector3(0.2, 0.08, -0.4825)}, 
		]
		_tile = _block_mesh(Vector3(TILE_SIZE, TILE_HEIGHT, TILE_SIZE), 0.024, 0.0, 0, 11, Vector3i(14, 1, 14), chips)
	return _tile




func _looks() -> Dictionary:
	return {
		"outpost": {
			"sun_color": Color(1.0, 0.9, 0.76), "sun_energy": 2.5, "sun_dir": Vector3(0.78, -0.56, 0.3), 
			"fill_color": Color(0.6, 0.66, 0.82), "fill_energy": 0.3, "fill_dir": Vector3(-0.5, -0.5, -0.7), 
			"ambient": Color(0.38, 0.41, 0.48), "ambient_energy": 0.46, 
			"sky_top": Color(0.05, 0.06, 0.085), "sky_horizon": Color(0.085, 0.095, 0.12), "sky_bottom": Color(0.045, 0.054, 0.075), 
			"sky_glow": Color(0.12, 0.1, 0.08), "sky_glow_dir": Vector3(-0.8, 0.0, -0.6), 
			"fog_color": Color(0.035, 0.045, 0.07), "fog_density": 0.006, "fog_height": -0.6, "fog_height_density": 0.55, 
			"vol_density": 0.0, "vol_albedo": Color(0.9, 0.9, 0.9), "vol_emission": Color(0.0, 0.0, 0.0), 
			"exposure": 1.0, "glow": 0.65, 
			"stone_a": Color(0.47, 0.425, 0.39), "stone_b": Color(0.36, 0.34, 0.345), "stone_edge": Color(0.66, 0.6, 0.53), 
			"moss_a": Color(0.2, 0.27, 0.07), "moss_b": Color(0.44, 0.47, 0.14), "moss": 0.75, "wet": 0.0, "rough": 0.86, 
		}, 
		"crypt": {
			"sun_color": Color(0.55, 0.8, 0.86), "sun_energy": 1.6, "sun_dir": Vector3(-0.35, -0.8, 0.45), 
			"fill_color": Color(0.16, 0.55, 0.6), "fill_energy": 0.5, "fill_dir": Vector3(0.6, -0.4, -0.6), 
			"ambient": Color(0.17, 0.3, 0.36), "ambient_energy": 0.46, 
			"sky_top": Color(0.008, 0.028, 0.036), "sky_horizon": Color(0.02, 0.08, 0.09), "sky_bottom": Color(0.004, 0.014, 0.02), 
			"sky_glow": Color(0.04, 0.36, 0.4), "sky_glow_dir": Vector3(0.6, 0.1, -0.8), 
			"fog_color": Color(0.02, 0.06, 0.07), "fog_density": 0.02, "fog_height": -0.4, "fog_height_density": 0.8, 
			"vol_density": 0.022, "vol_albedo": Color(0.6, 0.9, 0.92), "vol_emission": Color(0.0, 0.01, 0.012), 
			"exposure": 1.05, "glow": 0.8, 
			"stone_a": Color(0.3, 0.33, 0.34), "stone_b": Color(0.22, 0.25, 0.27), "stone_edge": Color(0.45, 0.5, 0.5), 
			"moss_a": Color(0.08, 0.18, 0.14), "moss_b": Color(0.15, 0.3, 0.24), "moss": 0.35, "wet": 0.7, "rough": 0.62, 
		}, 
		"court": {
			"sun_color": Color(1.0, 0.86, 0.7), "sun_energy": 2.3, "sun_dir": Vector3(0.5, -0.7, 0.5), 
			"fill_color": Color(0.62, 0.55, 0.6), "fill_energy": 0.32, "fill_dir": Vector3(-0.6, -0.4, -0.6), 
			"ambient": Color(0.4, 0.37, 0.38), "ambient_energy": 0.46, 
			"sky_top": Color(0.052, 0.05, 0.062), "sky_horizon": Color(0.09, 0.08, 0.085), "sky_bottom": Color(0.045, 0.042, 0.052), 
			"sky_glow": Color(0.14, 0.09, 0.06), "sky_glow_dir": Vector3(-0.5, 0.05, -0.85), 
			"fog_color": Color(0.035, 0.035, 0.05), "fog_density": 0.006, "fog_height": -0.6, "fog_height_density": 0.4, 
			"vol_density": 0.0, "vol_albedo": Color(0.9, 0.9, 0.9), "vol_emission": Color(0.0, 0.0, 0.0), 
			"exposure": 1.0, "glow": 0.7, 
			"stone_a": Color(0.55, 0.47, 0.4), "stone_b": Color(0.42, 0.36, 0.33), "stone_edge": Color(0.75, 0.66, 0.55), 
			"moss_a": Color(0.2, 0.2, 0.1), "moss_b": Color(0.3, 0.3, 0.15), "moss": 0.0, "wet": 0.15, "rough": 0.7, 
		}, 
	}


func _apply_environment() -> void :
	var e: = environment
	e.background_mode = Environment.BG_SKY
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = _look.ambient
	e.ambient_light_energy = _look.ambient_energy
	e.reflected_light_source = Environment.REFLECTION_SOURCE_BG
	e.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	e.tonemap_exposure = _look.exposure
	e.tonemap_white = 6.0
	e.glow_enabled = true
	e.glow_intensity = _look.glow
	e.glow_strength = 1.0
	e.glow_bloom = 0.02
	e.glow_hdr_threshold = 1.0
	e.glow_blend_mode = Environment.GLOW_BLEND_MODE_SOFTLIGHT

	var forward_plus: = RenderingServer.get_current_rendering_method() == "forward_plus"
	e.ssao_enabled = forward_plus
	e.ssao_radius = 0.7
	e.ssao_intensity = 2.2
	e.ssao_power = 1.5
	e.ssao_detail = 0.6
	e.ssil_enabled = forward_plus
	e.ssil_radius = 2.0
	e.ssil_intensity = 0.7
	e.fog_enabled = true
	e.fog_mode = Environment.FOG_MODE_EXPONENTIAL
	e.fog_light_color = _look.fog_color
	e.fog_light_energy = 1.0
	e.fog_density = _look.fog_density
	e.fog_height = _look.fog_height
	e.fog_height_density = _look.fog_height_density
	e.fog_sky_affect = 0.0
	e.fog_sun_scatter = 0.0
	e.volumetric_fog_enabled = forward_plus and float(_look.vol_density) > 0.0
	e.volumetric_fog_density = _look.vol_density
	e.volumetric_fog_albedo = _look.vol_albedo
	e.volumetric_fog_emission = _look.vol_emission
	e.volumetric_fog_anisotropy = 0.55
	e.volumetric_fog_length = 48.0
	e.volumetric_fog_sky_affect = 0.0
	e.adjustment_enabled = true
	e.adjustment_contrast = 1.05
	e.adjustment_saturation = 1.08
	_sky_material.set_shader_parameter("top_color", _look.sky_top)
	_sky_material.set_shader_parameter("horizon_color", _look.sky_horizon)
	_sky_material.set_shader_parameter("bottom_color", _look.sky_bottom)
	_sky_material.set_shader_parameter("glow_color", _look.sky_glow)
	_sky_material.set_shader_parameter("glow_dir", _look.sky_glow_dir)
	_aim(_key, _look.sun_dir)
	_aim(_fill, _look.fill_dir)


func _aim(light: DirectionalLight3D, direction: Vector3) -> void :
	var d: = direction.normalized()
	light.basis = Basis.looking_at(d, Vector3.UP if absf(d.y) < 0.99 else Vector3.FORWARD)


func _apply_mood(mood: Vector2) -> void :
	_mood = mood
	if _look.is_empty():
		return
	var level: = mood.x
	var warmth: = mood.y
	var cold: = clampf((1.0 - level) / 0.55, 0.0, 1.0)
	var bright: = clampf(level - 1.0, 0.0, 1.0)
	var sun: Color = _look.sun_color
	sun = sun.lerp(Color(0.62, 0.7, 0.95), cold * 0.55).lerp(Color(1.0, 0.64, 0.36), warmth * 0.5)
	_key.light_color = sun
	_key.light_energy = float(_look.sun_energy) * level
	_fill.light_color = _look.fill_color
	_fill.light_energy = float(_look.fill_energy) * lerpf(1.0, 0.8, cold)
	var ambient: Color = _look.ambient
	environment.ambient_light_color = ambient.lerp(Color(0.24, 0.3, 0.5), cold * 0.6).lerp(Color(0.55, 0.42, 0.34), warmth * 0.3)
	environment.ambient_light_energy = float(_look.ambient_energy) * lerpf(1.0, 0.65, cold) * (1.0 + bright * 0.35)
	environment.adjustment_saturation = 1.08 - cold * 0.3 + bright * 0.1
	environment.tonemap_exposure = float(_look.exposure) * (1.0 + bright * 0.12)


func _flame_mood() -> float:
	return lerpf(0.55, 1.0, clampf((_mood.x - 0.45) / 0.55, 0.0, 1.0)) * (1.0 + clampf(_mood.x - 1.0, 0.0, 1.0) * 0.6 + _mood.y * 0.2)




func _shader(key: String, code: String) -> Shader:
	if not _shaders.has(key):
		var shader: = Shader.new()
		shader.code = code
		_shaders[key] = shader
	return _shaders[key]


func _build_materials() -> void :
	var stone: = ShaderMaterial.new()
	stone.shader = _shader("stone", STONE_SHADER)
	stone.set_shader_parameter("stone_a", _look.stone_a)
	stone.set_shader_parameter("stone_b", _look.stone_b)
	stone.set_shader_parameter("stone_edge", _look.stone_edge)
	stone.set_shader_parameter("moss_a", _look.moss_a)
	stone.set_shader_parameter("moss_b", _look.moss_b)
	stone.set_shader_parameter("moss", _look.moss)
	stone.set_shader_parameter("wet", _look.wet)
	stone.set_shader_parameter("rough", _look.rough)
	_materials["stone"] = stone
	var bed: = StandardMaterial3D.new()
	bed.albedo_color = Color(0.07, 0.062, 0.06)
	bed.roughness = 1.0
	_materials["bed"] = bed




func _build_platform() -> void :

	var bed: = MeshInstance3D.new()
	var bed_mesh: = BoxMesh.new()
	bed_mesh.size = Vector3(RIM_IN * 2.0 + 0.3, 0.5, RIM_IN * 2.0 + 0.3)
	bed.mesh = bed_mesh
	bed.position.y = -0.03 - 0.25
	bed.material_override = _materials["bed"]
	_content.add_child(bed)

	for side in 4:
		_lay_rim(side)
		for course in range(1, SKIN_COURSES + 1):
			_lay_skin(side, course)
	for corner in 4:
		_lay_corner(corner)



func _lay_rim(side: int) -> void :
	var n: = SIDES[side]
	var t: = Vector3( - n.z, 0.0, n.x)
	var along: = - RIM_IN
	var far_side: = side == 0 or side == 3
	while along < RIM_IN - 0.05:
		var length: = _rng.randf_range(0.38, 0.6)
		if _rng.randf() < 0.12:
			length = _rng.randf_range(0.8, 0.95)
		length = minf(length, RIM_IN - along)
		if length < 0.2:
			break
		var mid: = along + length * 0.5
		var gap: = _rng.randf() < 0.07
		var height: = _rng.randf_range(0.36, 0.44)
		var depth: = _rng.randf_range(0.44, 0.52)
		if gap:
			height *= _rng.randf_range(0.35, 0.55)
		var inset: = RIM_IN + depth * 0.5 + _rng.randf_range(0.0, 0.03)
		var center: = n * inset + t * mid + Vector3.UP * (RIM_BASE + height * 0.5)
		_add_block(center, Vector3(length - 0.03, height, depth), n, 0.25, 1.0)
		var stack_chance: = 0.28 if far_side else 0.08
		if not gap and _rng.randf() < stack_chance:
			var h2: = _rng.randf_range(0.32, 0.4)
			var l2: = minf(length, _rng.randf_range(0.36, 0.5))
			var c2: = n * (inset + _rng.randf_range(-0.03, 0.03)) + t * (mid + _rng.randf_range(-0.06, 0.06)) + Vector3.UP * (RIM_BASE + height + h2 * 0.5 + 0.005)
			_add_block(c2, Vector3(l2 - 0.03, h2, depth * _rng.randf_range(0.8, 0.95)), n, 0.35, 1.0)
		along += length



func _lay_skin(side: int, course: int) -> void :
	var n: = SIDES[side]
	var t: = Vector3( - n.z, 0.0, n.x)
	var along: = - RIM_IN - (0.22 if course % 2 == 1 else 0.0)
	var top: = RIM_BASE - (course - 1) * COURSE
	var ragged: = course >= SKIN_COURSES - 2
	while along < RIM_IN - 0.05:
		var length: = _rng.randf_range(0.4, 0.62)
		if _rng.randf() < 0.18:
			length = _rng.randf_range(0.8, 1.0)
		var start: = maxf(along, - RIM_IN)
		var end: = minf(along + length, RIM_IN)
		along += length
		if end - start < 0.16:
			continue
		if ragged and _rng.randf() < 0.3 + 0.2 * (course - SKIN_COURSES + 2):
			continue
		var height: = COURSE - _rng.randf_range(0.01, 0.035)
		var depth: = _rng.randf_range(0.46, 0.54)
		var out: = RIM_OUT - depth * 0.5 + _rng.randf_range(-0.035, 0.03)
		var center: = n * out + t * (start + end) * 0.5 + Vector3.UP * (top - COURSE * 0.5 - 0.01)
		_add_block(center, Vector3(end - start - 0.025, height, depth), n, 0.06, 1.0)



func _lay_corner(corner: int) -> void :
	var sx: = 1.0 if corner == 1 or corner == 2 else -1.0
	var sz: = 1.0 if corner >= 2 else -1.0
	var c: = Vector3(sx, 0.0, sz) * (RIM_IN + WALL_DEPTH * 0.5)
	var h: = _rng.randf_range(0.38, 0.44)
	_add_block(c + Vector3.UP * (RIM_BASE + h * 0.5), Vector3(0.5, h, 0.5), Vector3(sx, 0, 0), 0.3, 1.0)
	for course in range(1, SKIN_COURSES):
		var top: = RIM_BASE - (course - 1) * COURSE
		_add_block(c + Vector3.UP * (top - COURSE * 0.5 - 0.01), Vector3(0.52, COURSE - 0.02, 0.52), Vector3(sx, 0, 0), 0.05, 1.0)







const RIM_MID: = RIM_IN + WALL_DEPTH * 0.5
const IVY: Array[Color] = [Color(0.17, 0.31, 0.09), Color(0.27, 0.42, 0.11), Color(0.13, 0.25, 0.1), Color(0.33, 0.45, 0.14)]
const AUTUMN: Array[Color] = [Color(0.72, 0.17, 0.06), Color(0.82, 0.36, 0.08), Color(0.58, 0.1, 0.05), Color(0.86, 0.52, 0.12)]



func _surface(x: float, z: float, radius: = 0.06) -> Vector3:
	var best: = - INF
	for top in _tops:
		var rect: Rect2 = top[0]
		if rect.grow(radius).has_point(Vector2(x, z)):
			best = maxf(best, float(top[1]))
	assert (best > - INF, "no stone under (%.2f, %.2f)" % [x, z])
	return Vector3(x, best, z)


func _place(node: Node3D, at: Vector3, yaw: = 0.0) -> Node3D:
	node.position = at
	node.rotation.y = yaw
	_content.add_child(node)
	return node



func _place_lit(prop: Dictionary, at: Vector3, yaw: = 0.0) -> void :
	_place(prop.node, at, yaw)
	for light: OmniLight3D in prop.lights:
		_flames.append({"light": light, "speed": _rng.randf_range(0.8, 1.25), "phase": _rng.randf() * 10.0, 
			"energy": light.light_energy, "flicker": 0.14})



func _glow(at: Vector3, color: Color, energy: float, reach: float) -> void :
	var light: = OmniLight3D.new()
	light.position = at
	light.light_color = color
	light.light_energy = energy
	light.omni_range = reach
	light.shadow_enabled = false
	light.light_volumetric_fog_energy = 2.0
	_content.add_child(light)
	_flames.append({"light": light, "speed": 0.3, "phase": _rng.randf() * 10.0, "energy": energy, "flicker": 0.05})



func _pillar(base: Vector3, height: float, moss: float) -> Vector3:
	var y: = base.y
	_add_block(Vector3(base.x, y + 0.11, base.z), Vector3(0.76, 0.22, 0.76), Vector3.FORWARD, moss, 0.5)
	y += 0.22
	var shaft: = height - 0.44
	var drums: = maxi(1, roundi(shaft / 0.36))
	for i in drums:
		var h: = shaft / drums
		var nudge: = Vector3(_rng.randf_range(-0.015, 0.015), 0, _rng.randf_range(-0.015, 0.015))
		_add_block(Vector3(base.x, y + h * 0.5, base.z) + nudge, Vector3(0.56, h - 0.015, 0.56), Vector3.FORWARD, moss, 1.2)
		y += h
	_add_block(Vector3(base.x, y + 0.11, base.z), Vector3(0.7, 0.22, 0.7), Vector3.FORWARD, moss, 0.5)
	return Vector3(base.x, y + 0.22, base.z)


func _rubble(center: Vector3, count: int, spread: float, moss: float) -> void :
	for i in count:
		var s: = _rng.randf_range(0.08, 0.17)
		var at: = center + Vector3(_rng.randf_range( - spread, spread), 0, _rng.randf_range( - spread, spread))
		var facing: = Vector3(_rng.randf_range(-1, 1), 0, _rng.randf_range(-1, 1)).normalized()
		_add_block(at + Vector3.UP * s * 0.45, Vector3(s * _rng.randf_range(0.9, 1.4), s * 0.8, s), facing, moss, 3.0)



func _vine(top: Vector3, n: Vector3, length: float, autumn: = 0.15) -> void :
	var t: = Vector3( - n.z, 0, n.x)
	var drift: = _rng.randf_range(-1.0, 1.0)
	var steps: = int(length / 0.05)
	for strand in 2:
		var p: = top + n * 0.03 + t * (strand - 0.5) * 0.14
		var wander: = drift + _rng.randf_range(-0.5, 0.5)
		var strand_steps: = steps if strand == 0 else int(steps * _rng.randf_range(0.5, 0.85))
		for i in strand_steps:
			p += Vector3.DOWN * 0.05 + t * (sin(i * 0.45 + wander * 4.0) * 0.016 + wander * 0.006)
			var taper: = lerpf(1.0, 0.6, float(i) / steps)
			for k in 3:
				var at: = p + t * _rng.randf_range(-0.08, 0.08) * taper + n * _rng.randf_range(0.0, 0.06)
				var facing: = (n + t * _rng.randf_range(-0.6, 0.6) + Vector3.UP * _rng.randf_range(-0.2, 0.5)).normalized()
				_leaves[0].append(ArenaProps.leaf(_rng, at, facing, _rng.randf_range(0.11, 0.17) * taper, _leaf_color(autumn), 1.0))

	for k in 18:
		var at: = top + t * _rng.randf_range(-0.24, 0.24) - n * _rng.randf_range(0.0, 0.3) + Vector3.UP * 0.01
		var facing: = (Vector3.UP * 1.4 + n * _rng.randf_range(0.0, 0.8) + t * _rng.randf_range(-0.5, 0.5)).normalized()
		_leaves[0].append(ArenaProps.leaf(_rng, at, facing, _rng.randf_range(0.12, 0.17), _leaf_color(autumn), 0.6))



func _bush(center: Vector3, radius: float, autumn: = 0.1) -> void :
	for k in int(radius * 260.0):
		var direction: = Vector3(_rng.randf_range(-1, 1), _rng.randf_range(0.1, 1.0), _rng.randf_range(-1, 1)).normalized()
		var at: = center + direction * radius * _rng.randf_range(0.5, 1.0)
		_leaves[0].append(ArenaProps.leaf(_rng, at, direction, _rng.randf_range(0.12, 0.18), _leaf_color(autumn), 0.8))



func _fallen(a: Vector2, b: Vector2, count: int) -> void :
	for k in count:
		var point: = a.lerp(b, _rng.randf()) + Vector2(_rng.randf_range(-0.12, 0.12), _rng.randf_range(-0.12, 0.12))
		var at: = _surface(point.x, point.y)
		var color: Color = AUTUMN[_rng.randi() % AUTUMN.size()] * _rng.randf_range(0.75, 1.1)
		_leaves[1].append(ArenaProps.fallen_leaf(_rng, at, _rng.randf_range(0.13, 0.2), color))


func _leaf_color(autumn: float) -> Color:
	var palette: = AUTUMN if _rng.randf() < autumn else IVY
	return palette[_rng.randi() % palette.size()] * _rng.randf_range(0.8, 1.15)


func _flush_leaves() -> void :
	for shape in _leaves:
		if not _leaves[shape].is_empty():
			_content.add_child(ArenaProps.foliage(_leaves[shape], shape))
	_leaves = {0: [], 1: [], 2: []}



func _rim(side: int, along: float, depth: = RIM_MID) -> Vector3:
	var n: = SIDES[side]
	var t: = Vector3( - n.z, 0.0, n.x)
	var point: = n * depth + t * along
	return _surface(point.x, point.z)


func _corner(sx: float, sz: float) -> Vector3:
	return _surface(sx * RIM_MID, sz * RIM_MID)




const RELIC_SLOTS: Array[float] = [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5]
const RELIC_FOOTPRINT: = 0.28


func relic_spot(index: int) -> Vector3:
	assert (index >= 0 and index < RELIC_SLOTS.size(), "No relic slot %d" % index)
	return _surface(RELIC_SLOTS[index], RIM_MID, RELIC_FOOTPRINT)



func _dress_outpost() -> void :
	var foot: = _corner(-1, -1)
	var pillar_top: = _pillar(foot, 1.5, 0.8)
	_bush(_rim(3, -2.3) + Vector3(0.0, 0.16, 0.0), 0.26, 0.25)
	_rubble(_rim(0, -2.2), 3, 0.08, 0.6)
	_place(ArenaProps.banner(1.9, Color(0.46, 0.07, 0.07), Color(0.86, 0.63, 0.27)), _rim(0, 1.5), 0.0)
	_place_lit(ArenaProps.lantern(), _corner(1, -1), 0.3)
	_place(ArenaProps.books(_rng), _corner(-1, 1), 0.4)
	var cloth: = ArenaProps.hanging_cloth(0.62, 1.45, Color(0.46, 0.07, 0.07), Color(0.86, 0.63, 0.27), true)
	var hang: = _rim(2, -1.9)
	_place(cloth, Vector3(hang.x, hang.y - 0.02, RIM_OUT + 0.06))
	_place(ArenaProps.crate(0.42), _rim(3, -1.6), 0.35)
	for spot in [[2, 0.0, 1.0], [2, 1.0, 0.7], [2, 2.0, 1.2], [1, 2.2, 0.9], [1, 0.3, 1.1], [1, -1.9, 0.6]]:
		var side: int = spot[0]
		_vine(_rim(side, spot[1], RIM_OUT - 0.02), SIDES[side], spot[2], 0.18)
	for spot in [[0, -1.2, 0.5], [3, 0.8, 0.55], [3, -0.4, 0.35]]:
		var side: int = spot[0]
		_vine(_rim(side, spot[1], RIM_IN + 0.02), - SIDES[side], spot[2], 0.1)
	_fallen(Vector2(-2.6, - RIM_MID), Vector2(-0.8, - RIM_MID), 9)
	_fallen(Vector2( - RIM_MID, 0.4), Vector2( - RIM_MID, 2.4), 8)
	_fallen(Vector2(1.2, RIM_MID), Vector2(2.8, RIM_MID), 6)
	_fallen(Vector2(RIM_MID, -0.6), Vector2(RIM_MID, 1.8), 6)
	_place_lit(ArenaProps.candles(_rng), pillar_top)



func _dress_crypt() -> void :
	var tall_left: = _pillar(_corner(-1, -1), 1.6, 0.3)
	var tall_right: = _pillar(_corner(1, -1), 1.3, 0.3)
	_rubble(_rim(3, 1.9), 3, 0.08, 0.3)
	_pillar(_corner(-1, 1), 0.6, 0.3)
	_pillar(_rim(0, -0.2), 0.75, 0.3)
	_rubble(_rim(1, 1.6), 4, 0.12, 0.3)
	_place_lit(ArenaProps.candles(_rng), tall_left)
	_place_lit(ArenaProps.candles(_rng), tall_right)
	_place_lit(ArenaProps.candles(_rng), _rim(3, 1.2))
	_place_lit(ArenaProps.candles(_rng), _rim(2, 2.0))
	_place_lit(ArenaProps.candles(_rng), _rim(0, 1.6))
	_glow(Vector3(-4.3, 1.2, -4.3), Color(0.2, 0.85, 0.8), 3.2, 6.0)
	_glow(Vector3(4.2, 0.9, -4.4), Color(0.15, 0.7, 0.75), 2.4, 5.0)
	_place(ArenaProps.books(_rng), _rim(3, -1.4), -0.3)
	for spot in [[2, -1.0, 0.8], [1, -0.8, 0.6], [2, 1.0, 0.5]]:
		var side: int = spot[0]
		_vine(_rim(side, spot[1], RIM_OUT - 0.02), SIDES[side], spot[2], 0.0)



func _dress_court() -> void :
	var red: = Color(0.5, 0.06, 0.06)
	var trim: = Color(0.9, 0.66, 0.28)
	_place(ArenaProps.banner(2.0, red, trim), _corner(-1, -1), PI * 0.25)
	_place(ArenaProps.banner(2.0, red, trim), _corner(1, -1), - PI * 0.25)
	_place_lit(ArenaProps.candelabra(), _corner(-1, 1), 0.4)
	_place_lit(ArenaProps.candelabra(), _corner(1, 1), -0.4)
	_place_lit(ArenaProps.candles(_rng), _rim(0, -1.0))
	_place_lit(ArenaProps.candles(_rng), _rim(3, 0.9))
	for spot in [[2, -1.6], [2, 1.6], [1, -1.6], [1, 1.6]]:
		var side: int = spot[0]
		var n: = SIDES[side]
		var t: = Vector3( - n.z, 0.0, n.x)
		var top: = _rim(side, spot[1])

		top.y = maxf(top.y, maxf(_rim(side, spot[1] - 0.26).y, _rim(side, spot[1] + 0.26).y))
		var edge: = top + n * (RIM_OUT - RIM_MID + 0.06)
		var path: = PackedVector3Array([top - n * 0.22 + Vector3.UP * 0.01, edge + Vector3.UP * 0.01, edge + Vector3.DOWN * 0.95])
		_place(ArenaProps.runner(path, t, 0.56, red, trim), Vector3.ZERO)
	_place(ArenaProps.books(_rng), _rim(3, -1.5), 0.2)



func _add_block(center: Vector3, size: Vector3, facing: Vector3, moss: float, jitter: float) -> void :
	var kind: = "brick" if size.x > size.z * 1.55 or size.x > size.y * 1.8 else "cube"
	var count: = 3 if kind == "brick" else 6
	var mesh_size: = Vector3(2.0, 1.0, 1.0) if kind == "brick" else Vector3.ONE
	var key: = "%s%d" % [kind, _rng.randi() % count]
	var yaw: = atan2(facing.x, facing.z)
	if _rng.randf() < 0.5:
		yaw += PI
	var basis: = Basis(Vector3.UP, yaw + _rng.randf_range(-0.035, 0.035) * jitter)
	basis = basis * Basis(Vector3.RIGHT, _rng.randf_range(-0.02, 0.02) * jitter) * Basis(Vector3.FORWARD, _rng.randf_range(-0.02, 0.02) * jitter)
	basis = basis * Basis.from_scale(size / mesh_size)
	var reach: = Vector2(size.x, size.z) * 0.5 if absf(facing.z) >= absf(facing.x) else Vector2(size.z, size.x) * 0.5
	_tops.append([Rect2(Vector2(center.x, center.z) - reach, reach * 2.0), center.y + size.y * 0.5])
	var shade: = _rng.randf_range(0.84, 1.1)
	var warm: = _rng.randf_range(-0.04, 0.04)
	var tint: = Color(shade * (1.0 + warm), shade, shade * (1.0 - warm), clampf(moss * _rng.randf_range(0.5, 1.5), 0.0, 1.0))
	if not _blocks.has(key):
		_blocks[key] = []
	_blocks[key].append([Transform3D(basis, center), tint])


func _flush_blocks() -> void :
	for key in _blocks:
		var entries: Array = _blocks[key]
		var multimesh: = MultiMesh.new()
		multimesh.transform_format = MultiMesh.TRANSFORM_3D
		multimesh.use_colors = true
		multimesh.mesh = _kit_mesh(key)
		multimesh.instance_count = entries.size()
		for i in entries.size():
			multimesh.set_instance_transform(i, entries[i][0])
			multimesh.set_instance_color(i, entries[i][1])
		var instance: = MultiMeshInstance3D.new()
		instance.multimesh = multimesh
		instance.material_override = _materials["stone"]
		_content.add_child(instance)
	_blocks.clear()




func _kit_mesh(key: String) -> ArrayMesh:
	if not _kit.has(key):
		var index: = int(key.right(1))
		var seed: = 100 + index * 17 + (0 if key.begins_with("cube") else 1000)
		if key.begins_with("brick"):
			_kit[key] = _block_mesh(Vector3(2.0, 1.0, 1.0), 0.1, 0.035, 2 + index % 2, seed, Vector3i(5, 2, 2))
		else:
			_kit[key] = _block_mesh(Vector3.ONE, 0.1, 0.035, 1 + index % 3, seed, Vector3i(2, 2, 2))
	return _kit[key]


static func _axis_steps(half: float, radius: float, inner: int) -> PackedFloat32Array:
	var steps: = PackedFloat32Array([ - half, - half + radius * 0.42])
	for i in inner + 1:
		steps.append(lerpf( - half + radius, half - radius, float(i) / inner))
	steps.append(half - radius * 0.42)
	steps.append(half)
	return steps




static func _block_mesh(size: Vector3, radius: float, lump: float, chips: int, seed: int, inner: Vector3i, fixed_chips: Array[Dictionary] = []) -> ArrayMesh:
	var rng: = RandomNumberGenerator.new()
	rng.seed = seed
	var noise: = FastNoiseLite.new()
	noise.seed = seed
	noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	noise.fractal_type = FastNoiseLite.FRACTAL_NONE
	noise.frequency = 1.4
	var h: = size * 0.5
	var r: = minf(radius, minf(h.x, minf(h.y, h.z)) * 0.9)
	var steps: Array[PackedFloat32Array] = [_axis_steps(h.x, r, inner.x), _axis_steps(h.y, r, inner.y), _axis_steps(h.z, r, inner.z)]
	var lookup: = {}
	var box: = PackedVector3Array()
	var indices: = PackedInt32Array()
	for axis in 3:
		var u_axis: = (axis + 1) % 3
		var v_axis: = (axis + 2) % 3
		var us: = steps[u_axis]
		var vs: = steps[v_axis]
		for side in [-1.0, 1.0]:
			var face_normal: = Vector3.ZERO
			face_normal[axis] = side
			var grid: = PackedInt32Array()
			for j in vs.size():
				for i in us.size():
					var p: = Vector3.ZERO
					p[axis] = h[axis] * side
					p[u_axis] = us[i]
					p[v_axis] = vs[j]
					var id: int = lookup.get(p, -1)
					if id < 0:
						id = box.size()
						box.append(p)
						lookup[p] = id
					grid.append(id)
			var nu: = us.size()
			for j in vs.size() - 1:
				for i in nu - 1:
					var a: = grid[j * nu + i]
					var b: = grid[j * nu + i + 1]
					var c: = grid[(j + 1) * nu + i + 1]
					var d: = grid[(j + 1) * nu + i]
					if (box[b] - box[a]).cross(box[c] - box[a]).dot(face_normal) > 0.0:
						indices.append_array(PackedInt32Array([a, c, b, a, d, c]))
					else:
						indices.append_array(PackedInt32Array([a, b, c, a, c, d]))
	var count: = box.size()
	var verts: = PackedVector3Array()
	verts.resize(count)
	var uv: = PackedVector2Array()
	uv.resize(count)
	var uv2: = PackedVector2Array()
	uv2.resize(count)
	var inner_h: = h - Vector3(r, r, r)
	var shear: = Vector2(rng.randf_range(-0.03, 0.03), rng.randf_range(-0.03, 0.03)) * (1.0 if lump > 0.0 else 0.0)
	var taper: = rng.randf_range(0.0, 0.05) * (1.0 if lump > 0.0 else 0.0)
	var noise_offset: = Vector3(rng.randf_range(-50, 50), rng.randf_range(-50, 50), rng.randf_range(-50, 50))
	for k in count:
		var p: = box[k]
		var q: = p.clamp( - inner_h, inner_h)
		var n: = (p - q).normalized()
		var v: = q + n * r
		if lump > 0.0:
			v += n * noise.get_noise_3dv(v + noise_offset) * lump
			var rise: = (v.y / h.y) * 0.5 + 0.5
			v.x += v.y * shear.x - v.x * taper * rise
			v.z += v.y * shear.y - v.z * taper * rise
		verts[k] = v
		var d: = [h.x - absf(p.x), h.y - absf(p.y), h.z - absf(p.z)]
		d.sort()
		uv2[k] = Vector2(1.0 - smoothstep(0.0, r * 2.6, d[1]), 0.0)
		uv[k] = Vector2(p.y / h.y, (p.x + p.z) / (h.x + h.z))
	var chip_list: Array[Dictionary] = fixed_chips.duplicate()
	for c in chips:
		var corner: = Vector3(1.0 if rng.randf() < 0.5 else -1.0, 1.0 if rng.randf() < 0.72 else -1.0, 1.0 if rng.randf() < 0.5 else -1.0)
		var dir: = Vector3(corner.x * rng.randf_range(0.45, 1.0), corner.y * rng.randf_range(0.45, 1.0), corner.z * rng.randf_range(0.45, 1.0))
		var at: = Vector3(corner.x * h.x, corner.y * h.y, corner.z * h.z)
		if rng.randf() < 0.45:
			var flat: = rng.randi() % 3
			dir[flat] *= 0.12
			at[flat] *= rng.randf_range(-0.6, 0.6)
		chip_list.append({"dir": dir, "depth": rng.randf_range(0.14, 0.34) * minf(h.x, minf(h.y, h.z)), "at": at})
	for chip in chip_list:
		var dir: Vector3 = (chip.dir as Vector3).normalized()
		var plane: = (chip.at as Vector3).dot(dir) - float(chip.depth)
		for k in count:
			var excess: = verts[k].dot(dir) - plane
			if excess > 0.0:
				verts[k] = verts[k] - dir * excess
				uv2[k] = Vector2(uv2[k].x, 1.0)
	var normals: = PackedVector3Array()
	normals.resize(count)
	for i in range(0, indices.size(), 3):
		var a: = indices[i]
		var b: = indices[i + 1]
		var c: = indices[i + 2]
		var face: = (verts[c] - verts[a]).cross(verts[b] - verts[a])
		normals[a] = normals[a] + face
		normals[b] = normals[b] + face
		normals[c] = normals[c] + face
	for k in count:
		normals[k] = normals[k].normalized()
	var colors: = PackedColorArray()
	colors.resize(count)
	colors.fill(Color(1, 1, 1, 1))
	var arrays: = []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_COLOR] = colors
	arrays[Mesh.ARRAY_TEX_UV] = uv
	arrays[Mesh.ARRAY_TEX_UV2] = uv2
	arrays[Mesh.ARRAY_INDEX] = indices
	var mesh: = ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh




const NOISE_GLSL: = "\n// Loop lengths are uniforms rather than constants so shader compilers keep them as loops: the\n// Direct3D compiler behind browsers on Windows unrolls constant loops and takes seconds on the result.\nuniform int noise_octaves = 4;\nfloat hash13(vec3 p3) {\n\tp3 = fract(p3 * 0.1031);\n\tp3 += dot(p3, p3.zyx + 31.32);\n\treturn fract((p3.x + p3.y) * p3.z);\n}\nfloat vnoise(vec3 p) {\n\tvec3 i = floor(p);\n\tvec3 f = fract(p);\n\tvec3 u = f * f * (3.0 - 2.0 * f);\n\treturn mix(mix(mix(hash13(i), hash13(i + vec3(1.0, 0.0, 0.0)), u.x),\n\t\t\tmix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), u.x), u.y),\n\t\tmix(mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), u.x),\n\t\t\tmix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), u.x), u.y), u.z);\n}\nfloat fbm(vec3 p) {\n\tfloat total = 0.0;\n\tfloat amplitude = 0.5;\n\tfor (int i = 0; i < noise_octaves; i++) {\n\t\ttotal += amplitude * vnoise(p);\n\t\tp = p * 2.03 + vec3(1.7, 9.2, 4.1);\n\t\tamplitude *= 0.5;\n\t}\n\treturn total;\n}\n// 1 while a noise of this many cycles per pixel is still resolved, fading to 0 as it becomes\n// finer than the pixels (where it would only shimmer).\nfloat resolved(float cycles_per_pixel) {\n\treturn 1.0 - smoothstep(0.15, 0.5, cycles_per_pixel);\n}\n// fbm with each octave faded out once it is finer than the pixels (`px`: one pixel in p's units).\nfloat fbm_filtered(vec3 p, float px) {\n\tfloat total = 0.0;\n\tfloat amplitude = 0.5;\n\tfor (int i = 0; i < noise_octaves; i++) {\n\t\ttotal += amplitude * mix(0.5, vnoise(p), resolved(px));\n\t\tp = p * 2.03 + vec3(1.7, 9.2, 4.1);\n\t\tpx *= 2.03;\n\t\tamplitude *= 0.5;\n\t}\n\treturn total;\n}\n// Specular anti-aliasing: roughens the surface where its normal changes faster than the pixels can\n// show (the screen-space roughness limiter, which the Compatibility renderer lacks).\nfloat limit_roughness(vec3 normal, float roughness) {\n\tvec3 dndx = dFdx(normal);\n\tvec3 dndy = dFdy(normal);\n\tfloat variance = 0.25 * (dot(dndx, dndx) + dot(dndy, dndy));\n\treturn sqrt(clamp(roughness * roughness + min(2.0 * variance, 0.18), 0.0, 1.0));\n}\nvec3 perturb_normal(vec3 position, vec3 normal, float height) {\n\tvec3 dpx = dFdx(position);\n\tvec3 dpy = dFdy(position);\n\tfloat dhx = dFdx(height);\n\tfloat dhy = dFdy(height);\n\tvec3 r1 = cross(dpy, normal);\n\tvec3 r2 = cross(normal, dpx);\n\tfloat det = dot(dpx, r1);\n\tvec3 grad = sign(det) * (dhx * r1 + dhy * r2);\n\treturn normalize(abs(det) * normal - grad);\n}\n"

































































const STONE_SHADER: = """
shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx;

uniform vec3 stone_a : source_color = vec3(0.47, 0.425, 0.39);
uniform vec3 stone_b : source_color = vec3(0.36, 0.34, 0.345);
uniform vec3 stone_edge : source_color = vec3(0.66, 0.6, 0.53);
uniform vec3 moss_a : source_color = vec3(0.2, 0.27, 0.07);
uniform vec3 moss_b : source_color = vec3(0.44, 0.47, 0.14);
uniform float moss = 0.7;
uniform float wet = 0.0;
uniform float rough = 0.86;

varying vec3 world_pos;
varying vec3 world_normal;
varying vec4 tint;
varying vec2 wear;
varying vec2 local;
varying vec3 origin;
""" + NOISE_GLSL + "\nvoid vertex() {\n\tworld_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;\n\tworld_normal = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);\n\ttint = COLOR;\n\twear = UV2;\n\tlocal = UV;\n\torigin = MODEL_MATRIX[3].xyz;\n}\n\nvoid fragment() {\n\tvec3 p = world_pos;\n\t// One pixel's size in world units: fine detail fades out as the stone gets smaller on screen.\n\tfloat px = length(fwidth(p));\n\tfloat broad = fbm(p * 1.9 + origin * 1.7);\n\tfloat mid = fbm_filtered(p * 6.1 + 13.0, px * 6.1);\n\tfloat fine = mix(0.5, vnoise(p * 31.0), resolved(px * 31.0));\n\tvec3 color = mix(stone_a, stone_b, smoothstep(0.32, 0.68, broad));\n\tcolor *= tint.rgb;\n\tcolor *= 0.84 + 0.3 * mid;\n\tcolor *= 0.93 + 0.14 * fine;\n\t// Cracks: zero crossings of warped noise, kept sparse.\n\tvec3 w = p * 2.6 + origin;\n\tfloat crack_noise = fbm(w + vec3(fbm(w * 1.7), 0.0, fbm(w * 1.7 + 5.0)) * 0.6);\n\tfloat crack = (1.0 - smoothstep(0.0, 0.012, abs(crack_noise - 0.5))) * smoothstep(0.5, 0.7, vnoise(p * 1.3 + origin));\n\tcolor *= 1.0 - crack * 0.55;\n\t// Worn edges and fresh chips read lighter.\n\tcolor = mix(color, stone_edge * tint.rgb, wear.x * 0.5);\n\tcolor = mix(color, stone_edge * 1.05, wear.y * 0.55);\n\t// Moss on top faces and at the foot of side faces.\n\tfloat up = clamp(world_normal.y, 0.0, 1.0);\n\tfloat foot = smoothstep(-0.55, -0.95, local.x) * (1.0 - up);\n\tfloat field = fbm(p * 3.3 + vec3(7.0, 3.0, 1.0));\n\tfloat grow = field * (0.45 + 0.55 * max(up, foot)) + tint.a * 0.38 - wear.y * 0.2;\n\tfloat m = smoothstep(0.58, 0.7, grow) * moss * step(0.001, tint.a);\n\tvec3 moss_color = mix(moss_a, moss_b, smoothstep(0.3, 0.8, fine * 0.5 + mid * 0.7));\n\tcolor = mix(color, moss_color, m);\n\tfloat height = mid * 0.012 + fine * 0.004 - crack * 0.01 + m * fine * 0.01;\n\tvec3 normal = perturb_normal(VERTEX, NORMAL, height);\n\tNORMAL = normal;\n\tALBEDO = color;\n\tfloat r = rough + (mid - 0.5) * 0.2 + m * 0.08 - crack * 0.1;\n\tROUGHNESS = limit_roughness(normal, clamp(mix(r, r * 0.45, wet * (1.0 - up * 0.5)), 0.08, 1.0));\n\tSPECULAR = 0.35 + wet * 0.2;\n}\n"














































const SKY_SHADER: = "\nshader_type sky;\n\nuniform vec3 top_color : source_color = vec3(0.03, 0.045, 0.075);\nuniform vec3 horizon_color : source_color = vec3(0.1, 0.085, 0.085);\nuniform vec3 bottom_color : source_color = vec3(0.018, 0.025, 0.042);\nuniform vec3 glow_color : source_color = vec3(0.45, 0.24, 0.1);\nuniform vec3 glow_dir = vec3(-0.8, 0.0, -0.6);\n\nvoid sky() {\n\tfloat y = EYEDIR.y;\n\tvec3 color = mix(horizon_color, top_color, smoothstep(0.0, 0.55, y));\n\tcolor = mix(color, bottom_color, smoothstep(0.02, -0.75, y));\n\tvec3 flat_dir = normalize(vec3(EYEDIR.x, 0.0, EYEDIR.z) + vec3(0.0001));\n\tfloat toward = max(dot(flat_dir, normalize(glow_dir)), 0.0);\n\tfloat glow = pow(toward, 3.0) * exp(-abs(y + 0.18) * 4.0);\n\tcolor += glow_color * glow * 0.35;\n\tCOLOR = color;\n}\n"
