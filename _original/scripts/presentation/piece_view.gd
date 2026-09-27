class_name PieceView
extends Node3D




const PICK_LAYER: = 2

const IVORY: = {
	"albedo": Color("d9c39f"), "roughness": 0.6, "metallic": 0.0, "specular": 0.4, "stone_wear": 1.15, 
	"foot_shade": 0.28, "accent_color": Color("c9943f"), "accent_energy": 0.0, "cloth_color": Color("26437f"), 
	"gem_color": Color("4f94ff"), "gem_energy": 3.2, "rim_color": Color("e8d6b4"), "rim_strength": 0.1, 
	"temper_color": Color("d4a24e"), "dissolve_edge_color": Color(1.0, 0.62, 0.3), 
}
const OBSIDIAN: = {
	"albedo": Color("1d1c22"), "roughness": 0.3, "metallic": 0.0, "specular": 0.55, "stone_wear": 0.6, 
	"foot_shade": 0.2, "accent_color": Color("8a6b4c"), "accent_energy": 0.0, "cloth_color": Color("4a1620"), 
	"gem_color": Color("ff4a36"), "gem_energy": 2.4, "rim_color": Color("7c8496"), "rim_strength": 0.3, 
	"temper_color": Color("c0503a"), "dissolve_edge_color": Color(1.0, 0.25, 0.12), 
}

static var _shader: Shader
static var _ring_shader: Shader

var piece_id: = ""
var kind: = ""
var friendly: = true
var level: = 0
var body: MeshInstance3D
var material: ShaderMaterial
var pick_body: StaticBody3D

var _pick_shape: CollisionShape3D
var _threat_ring: MeshInstance3D
var _threat_material: ShaderMaterial
var _halo: Node3D
var _glow: = 0.0
var _glow_target: = 0.0
var _glow_color: = Palette.SELECT
var _lift: = 0.0
var _lift_target: = 0.0
var _time: = 0.0
var _selected: = false
var _hovered: = false
var _targeted: = false
var _hinted: = false
var _threatened: = false


func setup(piece: Dictionary) -> void :
	piece_id = piece.id
	friendly = piece.friendly
	_time = randf() * 10.0
	if _shader == null:
		_shader = load("res://shaders/piece.gdshader")
		_ring_shader = load("res://shaders/glow_ring.gdshader")
	body = MeshInstance3D.new()
	add_child(body)
	material = ShaderMaterial.new()
	material.shader = _shader
	body.material_override = material
	var values: Dictionary = IVORY if friendly else OBSIDIAN
	for key in values:
		material.set_shader_parameter(key, values[key])
	material.set_shader_parameter("glow_strength", 0.0)

	pick_body = StaticBody3D.new()
	pick_body.collision_layer = PICK_LAYER
	pick_body.collision_mask = 0
	pick_body.set_meta("piece_id", piece_id)
	_pick_shape = CollisionShape3D.new()
	_pick_shape.shape = CylinderShape3D.new()
	pick_body.add_child(_pick_shape)
	add_child(pick_body)

	_threat_ring = MeshInstance3D.new()
	var plane: = PlaneMesh.new()
	plane.size = Vector2(1.05, 1.05)
	_threat_ring.mesh = plane
	_threat_ring.position.y = 0.012
	_threat_ring.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_threat_material = ShaderMaterial.new()
	_threat_material.shader = _ring_shader
	_threat_material.set_shader_parameter("color", Palette.THREAT)
	_threat_material.set_shader_parameter("thickness", 0.07)
	_threat_ring.material_override = _threat_material
	_threat_ring.visible = false
	add_child(_threat_ring)

	kind = str(piece.kind)
	set_level(int(piece.level))



func _apply_mesh() -> void :
	body.mesh = PieceMeshes.get_mesh(kind, clampi(level, 0, PieceMeshes.MAX_TIER))
	var height: = PieceMeshes.height(kind)
	var shape: CylinderShape3D = _pick_shape.shape
	shape.radius = 0.38
	shape.height = height + 0.1
	_pick_shape.position.y = shape.height * 0.5
	if kind == "knight":
		body.rotation.y = deg_to_rad(-35.0) if friendly else deg_to_rad(160.0)
	else:
		body.rotation.y = 0.0
	material.set_shader_parameter("temper_level", clampi(level, 0, 3))
	_refresh_halo()


func set_kind(new_kind: String) -> void :
	kind = new_kind
	_apply_mesh()


func set_level(new_level: int) -> void :
	level = new_level
	_apply_mesh()


func top_height() -> float:
	return PieceMeshes.height(kind)


func set_selected(on: bool) -> void :
	_selected = on
	_refresh()


func set_hovered(on: bool) -> void :
	_hovered = on
	_refresh()


func set_targeted(on: bool) -> void :
	_targeted = on
	_refresh()


func set_hinted(on: bool) -> void :
	_hinted = on
	_refresh()


func set_threatened(on: bool) -> void :
	_threatened = on
	_threat_ring.visible = on


func clear_marks() -> void :
	_selected = false
	_hovered = false
	_targeted = false
	_hinted = false
	_refresh()


func _refresh() -> void :
	_lift_target = 0.14 if _selected else (0.04 if _hovered and friendly else 0.0)
	if _selected:
		_glow_target = 0.9
		_glow_color = Palette.SELECT
	elif _hinted:
		_glow_target = 1.1
		_glow_color = Palette.HINT
	elif _targeted:
		_glow_target = 0.8
		_glow_color = Palette.CAPTURE
	elif _hovered:
		_glow_target = 0.4
		_glow_color = Palette.INK
	else:
		_glow_target = 0.0


func _process(delta: float) -> void :
	_time += delta
	var blend: = 1.0 - exp( - delta * 10.0)
	_glow = lerpf(_glow, _glow_target, blend)
	_lift = lerpf(_lift, _lift_target, blend)
	var pulse: = 1.0
	if _targeted:
		pulse = 0.75 + 0.25 * sin(_time * 4.5)
	material.set_shader_parameter("glow_strength", _glow * pulse)
	material.set_shader_parameter("glow_color", _glow_color)
	var bob: = sin(_time * 2.6) * 0.022 if _selected else 0.0
	body.position.y = _lift + bob
	if _threatened:
		var beat: = fposmod(_time * 0.9, 1.0)
		_threat_material.set_shader_parameter("progress", 0.35 + beat * 0.5)
	if _halo:
		_halo.rotation.y += delta * 0.9
		_halo.position.y = top_height() * 0.62 + _lift + sin(_time * 1.7) * 0.03



func _refresh_halo() -> void :
	if level < 3 or not friendly:
		if _halo:
			_halo.queue_free()
			_halo = null
		return
	if _halo:
		return
	_halo = Node3D.new()
	add_child(_halo)
	var ring: = MeshInstance3D.new()
	var torus: = TorusMesh.new()
	torus.inner_radius = 0.36
	torus.outer_radius = 0.385
	torus.rings = 48
	torus.ring_segments = 6
	ring.mesh = torus
	ring.rotation_degrees = Vector3(18, 0, 8)
	ring.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var gold: = StandardMaterial3D.new()
	gold.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	gold.albedo_color = Color(1.0, 0.8, 0.42)
	gold.emission_enabled = true
	gold.emission = Color(1.0, 0.72, 0.3)
	gold.emission_energy_multiplier = 2.2
	ring.material_override = gold
	_halo.add_child(ring)
	var sparks: = GPUParticles3D.new()
	sparks.amount = 14
	sparks.lifetime = 1.6
	sparks.visibility_aabb = AABB(Vector3(-1, -1, -1), Vector3(2, 3, 2))
	var process: = ParticleProcessMaterial.new()
	process.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_RING
	process.emission_ring_axis = Vector3.UP
	process.emission_ring_radius = 0.38
	process.emission_ring_inner_radius = 0.3
	process.emission_ring_height = 0.05
	process.direction = Vector3.UP
	process.spread = 25.0
	process.initial_velocity_min = 0.08
	process.initial_velocity_max = 0.25
	process.gravity = Vector3(0, 0.05, 0)
	process.scale_min = 0.5
	process.scale_max = 1.0
	var fade: = Gradient.new()
	fade.set_color(0, Color(1.0, 0.9, 0.6, 0.0))
	fade.set_color(1, Color(1.0, 0.75, 0.35, 0.0))
	fade.add_point(0.3, Color(1.0, 0.88, 0.55, 1.0))
	var ramp: = GradientTexture1D.new()
	ramp.gradient = fade
	process.color_ramp = ramp
	sparks.process_material = process
	var quad: = QuadMesh.new()
	quad.size = Vector2(0.05, 0.05)
	quad.material = Vfx.spark_material(2.4)
	sparks.draw_pass_1 = quad
	_halo.add_child(sparks)



func travel(to: Vector3, style: String, duration: float) -> Tween:
	var from: = position
	var distance: = Vector2(to.x - from.x, to.z - from.z).length()
	var arc: = 0.12
	match style:
		"jump":
			arc = 0.75 + distance * 0.12
		"hop":
			arc = 0.3
	var step: = func(t: float) -> void :
		var eased: = t * t * (3.0 - 2.0 * t)
		var point: = from.lerp(to, eased)
		point.y += sin(PI * t) * arc
		position = point
	var tween: = create_tween()
	tween.tween_method(step, 0.0, 1.0, duration)
	tween.tween_callback( func() -> void : body.scale = Vector3(1.08, 0.9, 1.08))
	tween.tween_property(body, "scale", Vector3.ONE, 0.16).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	return tween



func bounce_towards(target: Vector3, duration: float) -> Tween:
	var home: = position
	var strike: = home.lerp(target, 0.45) + Vector3.UP * 0.2
	var tween: = create_tween()
	tween.tween_property(self, "position", strike, duration * 0.45).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tween.tween_property(self, "position", home, duration * 0.55).set_trans(Tween.TRANS_BOUNCE).set_ease(Tween.EASE_OUT)
	return tween



func shatter(vfx: Vfx, power: = 1.0) -> void :
	pick_body.collision_layer = 0
	set_threatened(false)
	clear_marks()
	_glow = 0.0
	var color: Color = IVORY.albedo if friendly else Color("2a2830")
	vfx.shards(global_position, color, 12 + int(power * 6.0), power)
	var tween: = create_tween()
	tween.tween_method( func(v: float) -> void : material.set_shader_parameter("dissolve", v), 0.0, 1.0, 0.42)
	tween.tween_callback(queue_free)


func promote(vfx: Vfx) -> void :
	vfx.pillar(global_position, Palette.GOLD_BRIGHT)
	vfx.burst(global_position + Vector3.UP * 0.6, Palette.GOLD_BRIGHT, 30, 2.6)
	var become_queen: = func() -> void :
		set_kind("queen")
		material.set_shader_parameter("promoted", 1.0)
	var tween: = create_tween()
	tween.tween_property(self, "scale", Vector3(1.25, 0.6, 1.25), 0.12)
	tween.tween_callback(become_queen)
	tween.tween_property(self, "scale", Vector3.ONE, 0.35).set_trans(Tween.TRANS_ELASTIC).set_ease(Tween.EASE_OUT)



func evolve(vfx: Vfx, new_level: int) -> void :
	vfx.pillar(global_position, Palette.MOVE)
	vfx.burst(global_position + Vector3.UP * 0.4, Palette.MOVE.lightened(0.3), 26, 2.2, 0.07)
	_glow = 2.4
	_glow_color = Palette.MOVE
	var tween: = create_tween()
	tween.tween_interval(0.18)
	tween.tween_callback(set_level.bind(new_level))
	tween.tween_property(body, "scale", Vector3(1.12, 1.12, 1.12), 0.1)
	tween.tween_property(body, "scale", Vector3.ONE, 0.3).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)



func sink(delay: float) -> Tween:
	pick_body.collision_layer = 0
	set_threatened(false)
	var tween: = create_tween()
	tween.tween_interval(delay)
	tween.tween_method( func(v: float) -> void : material.set_shader_parameter("dissolve", v), 0.0, 1.0, 0.5)
	tween.parallel().tween_property(self, "position:y", position.y - 0.25, 0.5)
	tween.tween_callback(queue_free)
	return tween



func topple(delay: float) -> void :
	set_threatened(false)
	var tween: = create_tween()
	tween.tween_interval(delay)
	var axis: = Vector3(randf_range(-1, 1), 0, randf_range(-1, 1)).normalized()
	tween.tween_property(self, "rotation", axis * deg_to_rad(80.0), 0.55).set_trans(Tween.TRANS_BOUNCE).set_ease(Tween.EASE_OUT)



func drop_in(delay: float) -> void :
	var rest: = position
	position = rest + Vector3.UP * 2.4
	scale = Vector3.ONE * 0.85
	var tween: = create_tween()
	tween.tween_interval(delay)
	tween.tween_property(self, "position", rest, 0.42).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
	tween.parallel().tween_property(self, "scale", Vector3.ONE, 0.42)
	tween.tween_callback( func() -> void : body.scale = Vector3(1.1, 0.86, 1.1))
	tween.tween_property(body, "scale", Vector3.ONE, 0.2).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
