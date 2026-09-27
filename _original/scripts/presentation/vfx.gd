class_name Vfx
extends Node3D



const GRAVITY: = 9.5
const FLOOR_Y: = 0.07

static var _dot: ImageTexture
static var _spark_materials: Dictionary = {}

var _shards: Array[Dictionary] = []
var _ring_shader: Shader = preload("res://shaders/glow_ring.gdshader")


static func dot_texture() -> ImageTexture:
	if _dot == null:
		var size: = 32
		var image: = Image.create(size, size, false, Image.FORMAT_RGBA8)
		var center: = (size - 1) / 2.0
		for y in size:
			for x in size:
				var d: = Vector2(x - center, y - center).length() / center
				var alpha: = pow(clampf(1.0 - d, 0.0, 1.0), 1.8)
				image.set_pixel(x, y, Color(1, 1, 1, alpha))
		_dot = ImageTexture.create_from_image(image)
	return _dot



static func spark_material(energy: = 1.6) -> StandardMaterial3D:
	if _spark_materials.has(energy):
		return _spark_materials[energy]
	var material: = StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	material.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	material.vertex_color_use_as_albedo = true
	material.albedo_texture = dot_texture()
	material.albedo_color = Color(energy, energy, energy, 1.0)
	material.disable_fog = true
	material.disable_receive_shadows = true
	_spark_materials[energy] = material
	return material


static func make_flame() -> GPUParticles3D:
	var flame: = GPUParticles3D.new()
	flame.amount = 36
	flame.lifetime = 0.9
	flame.position = Vector3(0, 0.22, 0)
	flame.visibility_aabb = AABB(Vector3(-1, -0.5, -1), Vector3(2, 3, 2))
	var process: = ParticleProcessMaterial.new()
	process.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	process.emission_sphere_radius = 0.14
	process.direction = Vector3.UP
	process.spread = 12.0
	process.initial_velocity_min = 0.45
	process.initial_velocity_max = 0.85
	process.gravity = Vector3(0, 0.7, 0)
	process.scale_min = 0.7
	process.scale_max = 1.25
	var curve: = Curve.new()
	curve.add_point(Vector2(0, 0.6))
	curve.add_point(Vector2(0.35, 1.0))
	curve.add_point(Vector2(1, 0.0))
	var scale_curve: = CurveTexture.new()
	scale_curve.curve = curve
	process.scale_curve = scale_curve
	var gradient: = Gradient.new()
	gradient.set_color(0, Color(1.0, 0.85, 0.45, 0.9))
	gradient.set_color(1, Color(0.8, 0.12, 0.04, 0.0))
	gradient.add_point(0.4, Color(1.0, 0.45, 0.12, 0.7))
	var ramp: = GradientTexture1D.new()
	ramp.gradient = gradient
	process.color_ramp = ramp
	flame.process_material = process
	var quad: = QuadMesh.new()
	quad.size = Vector2(0.32, 0.32)
	quad.material = spark_material(2.2)
	flame.draw_pass_1 = quad
	return flame


func _process(delta: float) -> void :
	for i in range(_shards.size() - 1, -1, -1):
		var shard: = _shards[i]
		var node: MeshInstance3D = shard.node
		shard.life -= delta
		if shard.life <= 0.0 or not is_instance_valid(node):
			if is_instance_valid(node):
				node.queue_free()
			_shards.remove_at(i)
			continue
		var velocity: Vector3 = shard.velocity
		velocity.y -= GRAVITY * delta
		var next_position: = node.position + velocity * delta
		if next_position.y < FLOOR_Y:
			next_position.y = FLOOR_Y
			velocity.y = absf(velocity.y) * 0.35
			velocity.x *= 0.6
			velocity.z *= 0.6
		shard.velocity = velocity
		node.position = next_position
		node.rotate(shard.axis, float(shard.spin) * delta)
		var fade: = clampf(shard.life / 0.35, 0.0, 1.0)
		node.scale = Vector3.ONE * float(shard.size) * fade



func shards(origin: Vector3, color: Color, count: = 16, power: = 1.0) -> void :
	var material: = _shard_material(color)
	var meshes: = [BoxMesh.new(), PrismMesh.new()]
	for i in count:
		var node: = MeshInstance3D.new()
		node.mesh = meshes[i % 2]
		node.material_override = material
		node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var size: = randf_range(0.06, 0.15)
		node.scale = Vector3.ONE * size
		node.position = origin + Vector3(randf_range(-0.15, 0.15), randf_range(0.2, 0.8), randf_range(-0.15, 0.15))
		add_child(node)
		var direction: = Vector3(randf_range(-1, 1), randf_range(0.6, 1.6), randf_range(-1, 1)).normalized()
		_shards.append({
			"node": node, 
			"velocity": direction * randf_range(2.2, 4.2) * power, 
			"axis": Vector3(randf(), randf(), randf()).normalized(), 
			"spin": randf_range(4.0, 14.0), 
			"life": randf_range(0.9, 1.5), 
			"size": size, 
		})


func burst(origin: Vector3, color: Color, amount: = 28, speed: = 3.2, size: = 0.09) -> void :
	var particles: = GPUParticles3D.new()
	particles.one_shot = true
	particles.explosiveness = 0.95
	particles.amount = amount
	particles.lifetime = 0.8
	particles.position = origin
	particles.visibility_aabb = AABB(Vector3(-4, -2, -4), Vector3(8, 6, 8))
	var process: = ParticleProcessMaterial.new()
	process.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	process.emission_sphere_radius = 0.15
	process.direction = Vector3.UP
	process.spread = 75.0
	process.initial_velocity_min = speed * 0.5
	process.initial_velocity_max = speed
	process.gravity = Vector3(0, -6.5, 0)
	process.damping_min = 1.0
	process.damping_max = 2.5
	process.scale_min = 0.5
	process.scale_max = 1.2
	var gradient: = Gradient.new()
	gradient.set_color(0, Color(color.lightened(0.4), 1.0))
	gradient.set_color(1, Color(color, 0.0))
	var ramp: = GradientTexture1D.new()
	ramp.gradient = gradient
	process.color_ramp = ramp
	particles.process_material = process
	var quad: = QuadMesh.new()
	quad.size = Vector2(size, size)
	quad.material = spark_material(2.4)
	particles.draw_pass_1 = quad
	add_child(particles)
	particles.emitting = true
	particles.finished.connect(particles.queue_free)


func ring(origin: Vector3, color: Color, radius: = 1.3, duration: = 0.55) -> void :
	var node: = MeshInstance3D.new()
	var plane: = PlaneMesh.new()
	plane.size = Vector2(radius * 2.0, radius * 2.0)
	node.mesh = plane
	node.position = Vector3(origin.x, 0.09, origin.z)
	node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var material: = ShaderMaterial.new()
	material.shader = _ring_shader
	material.set_shader_parameter("color", color)
	node.material_override = material
	add_child(node)
	var tween: = node.create_tween()
	tween.tween_method( func(value: float) -> void : material.set_shader_parameter("progress", value), 0.0, 1.0, duration).set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_CUBIC)
	tween.tween_callback(node.queue_free)


func flash(origin: Vector3, color: Color, energy: = 5.0, duration: = 0.3, reach: = 4.0) -> void :
	var light: = OmniLight3D.new()
	light.position = origin + Vector3(0, 0.8, 0)
	light.light_color = color
	light.omni_range = reach
	light.light_energy = energy
	light.shadow_enabled = false
	add_child(light)
	var tween: = light.create_tween()
	tween.tween_property(light, "light_energy", 0.0, duration).set_ease(Tween.EASE_OUT)
	tween.tween_callback(light.queue_free)


func float_text(origin: Vector3, text: String, color: Color, size: = 72, rise: = 0.9, duration: = 1.1) -> Label3D:
	var label: = Label3D.new()
	label.text = text
	label.font = UiTheme.display_font()
	label.font_size = size
	label.pixel_size = 0.004
	label.outline_size = 14
	label.outline_modulate = Color(0.02, 0.02, 0.03, 0.85)
	label.modulate = color
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.no_depth_test = true
	label.render_priority = 10
	label.outline_render_priority = 9
	label.position = origin
	label.scale = Vector3.ONE * 0.6
	add_child(label)
	var tween: = label.create_tween().set_parallel(true)
	tween.tween_property(label, "scale", Vector3.ONE, 0.18).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tween.tween_property(label, "position:y", origin.y + rise, duration).set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_QUART)
	tween.tween_property(label, "modulate:a", 0.0, duration * 0.45).set_delay(duration * 0.55)
	tween.chain().tween_callback(label.queue_free)
	return label


func pillar(origin: Vector3, color: Color, duration: = 0.9) -> void :
	var node: = MeshInstance3D.new()
	var cylinder: = CylinderMesh.new()
	cylinder.top_radius = 0.34
	cylinder.bottom_radius = 0.44
	cylinder.height = 4.0
	cylinder.cap_top = false
	cylinder.cap_bottom = false
	node.mesh = cylinder
	node.position = Vector3(origin.x, 2.0, origin.z)
	node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var material: = _pillar_material(color)
	node.material_override = material
	node.scale = Vector3(0.2, 1.0, 0.2)
	add_child(node)
	var tween: = node.create_tween()
	tween.tween_property(node, "scale", Vector3(1.0, 1.0, 1.0), duration * 0.25).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tween.tween_property(material, "albedo_color:a", 0.0, duration * 0.75)
	tween.tween_callback(node.queue_free)


static func _shard_material(color: Color) -> StandardMaterial3D:
	var material: = StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = 0.35
	material.emission_enabled = true
	material.emission = color.lightened(0.3)
	material.emission_energy_multiplier = 0.25
	return material


static func _pillar_material(color: Color) -> StandardMaterial3D:
	var material: = StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	material.cull_mode = BaseMaterial3D.CULL_DISABLED
	material.albedo_color = Color(color.r * 2.0, color.g * 2.0, color.b * 2.0, 0.55)
	material.disable_fog = true
	return material




func warm_up(at: Vector3) -> Node3D:
	var hold: = Node3D.new()
	hold.position = at
	add_child(hold)
	var shard: = MeshInstance3D.new()
	shard.mesh = BoxMesh.new()
	shard.material_override = _shard_material(Color.WHITE)
	hold.add_child(shard)
	var pillar_node: = MeshInstance3D.new()
	pillar_node.mesh = CylinderMesh.new()
	pillar_node.material_override = _pillar_material(Color.WHITE)
	hold.add_child(pillar_node)
	var ring_node: = MeshInstance3D.new()
	ring_node.mesh = PlaneMesh.new()
	var ring_material: = ShaderMaterial.new()
	ring_material.shader = _ring_shader
	ring_node.material_override = ring_material
	hold.add_child(ring_node)
	var label: = float_text(at, "+1", Color(1, 1, 1, 0), 60, 0.0, 0.3)
	label.modulate.a = 0.0
	burst(at, Color.WHITE, 1, 0.01, 0.05)
	return hold


func dust(origin: Vector3) -> void :
	burst(Vector3(origin.x, 0.12, origin.z), Color(0.75, 0.7, 0.62), 12, 1.1, 0.12)
