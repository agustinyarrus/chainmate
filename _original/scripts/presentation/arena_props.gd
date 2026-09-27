class_name ArenaProps
extends RefCounted





const FLAME_COLOR: = Color(1.0, 0.62, 0.3)

static var _materials: Dictionary = {}
static var _shaders: Dictionary = {}




static func standard(key: String, albedo: Color, roughness: float, metallic: = 0.0) -> StandardMaterial3D:
	if not _materials.has(key):
		var material: = StandardMaterial3D.new()
		material.albedo_color = albedo
		material.roughness = roughness
		material.metallic = metallic
		_materials[key] = material
	return _materials[key]


static func iron() -> StandardMaterial3D:
	return standard("iron", Color(0.11, 0.1, 0.1), 0.48, 0.75)


static func gold() -> StandardMaterial3D:
	return standard("gold", Color(0.86, 0.62, 0.28), 0.32, 1.0)


static func wax() -> StandardMaterial3D:
	if not _materials.has("wax"):
		var material: = standard("wax", Color(0.93, 0.86, 0.7), 0.55)

		material.subsurf_scatter_enabled = RenderingServer.get_current_rendering_method() == "forward_plus"
		material.subsurf_scatter_strength = 0.6
		material.rim_enabled = true
		material.rim = 0.3
	return _materials["wax"]


static func pages() -> StandardMaterial3D:
	return standard("pages", Color(0.86, 0.8, 0.66), 0.9)


static func leather(color: Color) -> StandardMaterial3D:
	return standard("leather_%s" % color.to_html(), color, 0.62)



static func glass() -> StandardMaterial3D:
	if not _materials.has("glass"):
		var material: = standard("glass", Color(1.0, 0.78, 0.45, 0.42), 0.15)
		material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		material.emission_enabled = true
		material.emission = Color(1.0, 0.6, 0.28)
		material.emission_energy_multiplier = 1.6
		material.cull_mode = BaseMaterial3D.CULL_DISABLED
	return _materials["glass"]


static func _shader(path: String) -> Shader:
	if not _shaders.has(path):
		_shaders[path] = load(path)
	return _shaders[path]


static func cloth(base: Color, trim: Color, emblem: bool, swallowtail: bool, wave: float) -> ShaderMaterial:
	var material: = ShaderMaterial.new()
	material.shader = _shader("res://shaders/cloth.gdshader")
	material.set_shader_parameter("base_color", base)
	material.set_shader_parameter("trim_color", trim)
	material.set_shader_parameter("emblem", emblem)
	material.set_shader_parameter("swallowtail", swallowtail)
	material.set_shader_parameter("wave", wave)
	material.set_shader_parameter("phase", randf() * 10.0)
	return material


static func wood(half_size: Vector3, planks: float, framed: bool) -> ShaderMaterial:
	var material: = ShaderMaterial.new()
	material.shader = _shader("res://shaders/wood.gdshader")
	material.set_shader_parameter("half_size", half_size)
	material.set_shader_parameter("planks", planks)
	material.set_shader_parameter("framed", framed)
	return material




static func part(parent: Node3D, mesh: Mesh, material: Material, at: Vector3, rotation: = Vector3.ZERO) -> MeshInstance3D:
	var node: = MeshInstance3D.new()
	node.mesh = mesh
	node.material_override = material
	node.position = at
	node.rotation = rotation
	parent.add_child(node)
	return node


static func box_mesh(size: Vector3) -> BoxMesh:
	var mesh: = BoxMesh.new()
	mesh.size = size
	return mesh


static func cylinder_mesh(top: float, bottom: float, height: float, segments: = 12) -> CylinderMesh:
	var mesh: = CylinderMesh.new()
	mesh.top_radius = top
	mesh.bottom_radius = bottom
	mesh.height = height
	mesh.radial_segments = segments
	mesh.rings = 1
	return mesh




static func flame(parent: Node3D, at: Vector3, size: float, energy: float, reach: float) -> OmniLight3D:
	var flame: = MeshInstance3D.new()
	var quad: = QuadMesh.new()
	quad.size = Vector2(size * 0.55, size)
	quad.center_offset = Vector3(0, size * 0.5, 0)
	flame.mesh = quad
	var material: = ShaderMaterial.new()
	material.shader = _shader("res://shaders/flame.gdshader")
	material.set_shader_parameter("seed", randf() * 20.0)
	flame.material_override = material
	flame.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	flame.position = at
	parent.add_child(flame)
	var light: = OmniLight3D.new()
	light.position = at + Vector3(0, size * 0.6, 0)
	light.light_color = FLAME_COLOR
	light.light_energy = energy
	light.omni_range = reach
	light.omni_attenuation = 1.6
	light.shadow_enabled = false
	light.light_volumetric_fog_energy = 0.6
	parent.add_child(light)
	return light



static func _hanging_sheet(width: float, height: float, columns: int, rows: int) -> ArrayMesh:
	var st: = SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for j in rows:
		for i in columns:
			var corners: Array[Vector2] = [Vector2(i, j), Vector2(i + 1, j), Vector2(i + 1, j + 1), Vector2(i, j + 1)]
			for index in [0, 1, 2, 0, 2, 3]:
				var c: Vector2 = corners[index]
				var uv: = Vector2(c.x / columns, c.y / rows)
				st.set_normal(Vector3.BACK)
				st.set_uv(uv)
				st.add_vertex(Vector3((uv.x - 0.5) * width, - uv.y * height, 0.0))
	return st.commit()





static func banner(height: float, base: Color, trim: Color) -> Node3D:
	var root: = Node3D.new()
	part(root, cylinder_mesh(0.03, 0.036, height, 8), iron(), Vector3(0, height * 0.5, 0))
	part(root, cylinder_mesh(0.07, 0.085, 0.07, 8), iron(), Vector3(0, 0.035, 0))
	var finial: = SphereMesh.new()
	finial.radius = 0.045
	finial.height = 0.09
	part(root, finial, gold(), Vector3(0, height + 0.04, 0))
	part(root, cylinder_mesh(0.0, 0.026, 0.12, 6), gold(), Vector3(0, height + 0.13, 0))
	var bar_y: = height - 0.08
	part(root, cylinder_mesh(0.016, 0.016, 0.72, 6), iron(), Vector3(0, bar_y, 0.03), Vector3(0, 0, PI * 0.5))
	for side in [-1.0, 1.0]:
		var cap: = SphereMesh.new()
		cap.radius = 0.028
		cap.height = 0.056
		part(root, cap, gold(), Vector3(side * 0.36, bar_y, 0.03))
	var sheet: = MeshInstance3D.new()
	sheet.mesh = _hanging_sheet(0.64, height * 0.62, 6, 16)
	sheet.material_override = cloth(base, trim, true, true, 1.0)
	sheet.position = Vector3(0, bar_y - 0.015, 0.035)
	root.add_child(sheet)
	return root



static func hanging_cloth(width: float, height: float, base: Color, trim: Color, emblem: bool) -> MeshInstance3D:
	var sheet: = MeshInstance3D.new()
	sheet.mesh = _hanging_sheet(width, height, 5, 12)
	sheet.material_override = cloth(base, trim, emblem, true, 0.35)
	return sheet



static func runner(path: PackedVector3Array, across: Vector3, width: float, base: Color, trim: Color) -> MeshInstance3D:
	var st: = SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var lengths: = PackedFloat32Array([0.0])
	for i in range(1, path.size()):
		lengths.append(lengths[i - 1] + path[i].distance_to(path[i - 1]))
	var total: = lengths[lengths.size() - 1]
	var half: = across.normalized() * width * 0.5
	for i in path.size() - 1:
		var a0: = path[i] - half
		var a1: = path[i] + half
		var b0: = path[i + 1] - half
		var b1: = path[i + 1] + half
		var v0: = lengths[i] / total
		var v1: = lengths[i + 1] / total
		var normal: = (b0 - a0).cross(a1 - a0).normalized()
		for vertex in [[a0, Vector2(0, v0)], [a1, Vector2(1, v0)], [b1, Vector2(1, v1)], [a0, Vector2(0, v0)], [b1, Vector2(1, v1)], [b0, Vector2(0, v1)]]:
			st.set_normal(normal)
			st.set_uv(vertex[1])
			st.add_vertex(vertex[0])
	var node: = MeshInstance3D.new()
	node.mesh = st.commit()
	var material: = cloth(base, trim, false, false, 0.0)
	material.set_shader_parameter("trim_width", 0.1)
	node.material_override = material
	return node



static func lantern() -> Dictionary:
	var root: = Node3D.new()
	var body: = Node3D.new()
	body.scale = Vector3.ONE * 1.6
	root.add_child(body)
	var w: = 0.2
	part(body, box_mesh(Vector3(w + 0.03, 0.035, w + 0.03)), iron(), Vector3(0, 0.0175, 0))
	part(body, box_mesh(Vector3(w + 0.02, 0.03, w + 0.02)), iron(), Vector3(0, 0.3, 0))
	for x in [-1.0, 1.0]:
		for z in [-1.0, 1.0]:
			part(body, box_mesh(Vector3(0.022, 0.29, 0.022)), iron(), Vector3(x * w * 0.5, 0.16, z * w * 0.5))
	part(body, box_mesh(Vector3(w - 0.01, 0.26, w - 0.01)), glass(), Vector3(0, 0.165, 0))
	var roof: = cylinder_mesh(0.018, w * 0.78, 0.12, 4)
	part(body, roof, iron(), Vector3(0, 0.375, 0), Vector3(0, PI * 0.25, 0))
	var ring: = TorusMesh.new()
	ring.inner_radius = 0.028
	ring.outer_radius = 0.042
	part(body, ring, iron(), Vector3(0, 0.46, 0), Vector3(PI * 0.5, 0, 0))
	part(body, cylinder_mesh(0.028, 0.03, 0.08, 10), wax(), Vector3(0, 0.075, 0))
	var light: = flame(root, Vector3(0, 0.19, 0), 0.13, 2.4, 3.6)
	return {"node": root, "lights": [light]}


static func candle(height: float, lit: = true) -> Dictionary:
	var root: = Node3D.new()
	part(root, cylinder_mesh(0.042, 0.046, height, 12), wax(), Vector3(0, height * 0.5, 0))
	part(root, cylinder_mesh(0.052, 0.058, 0.014, 12), wax(), Vector3(0, 0.007, 0))
	part(root, cylinder_mesh(0.003, 0.003, 0.025, 4), iron(), Vector3(0, height + 0.012, 0))
	var lights: Array = []
	var light: = flame(root, Vector3(0, height + 0.012, 0), 0.085, 0.8, 2.0)
	if lit:
		lights.append(light)
	else:
		light.queue_free()
	return {"node": root, "lights": lights}



static func candles(rng: RandomNumberGenerator) -> Dictionary:
	var root: = Node3D.new()
	var lights: Array = []
	var count: = rng.randi_range(2, 3)
	for i in count:
		var lit: = candle(rng.randf_range(0.1, 0.24), i == 0)
		var angle: = TAU * i / count + rng.randf_range(-0.3, 0.3)
		lit.node.position = Vector3(cos(angle), 0, sin(angle)) * (0.07 if i > 0 else 0.0)
		root.add_child(lit.node)
		lights.append_array(lit.lights)
	return {"node": root, "lights": lights}



static func candelabra() -> Dictionary:
	var root: = Node3D.new()
	part(root, cylinder_mesh(0.05, 0.1, 0.05, 12), gold(), Vector3(0, 0.025, 0))
	part(root, cylinder_mesh(0.016, 0.022, 0.42, 8), gold(), Vector3(0, 0.26, 0))
	part(root, cylinder_mesh(0.012, 0.012, 0.3, 6), gold(), Vector3(0, 0.42, 0), Vector3(0, 0, PI * 0.5))
	var lights: Array = []
	for x in [-0.15, 0.0, 0.15]:
		var centre: bool = x == 0.0
		var cup: = 0.47 if centre else 0.42
		part(root, cylinder_mesh(0.035, 0.018, 0.04, 10), gold(), Vector3(x, cup, 0))
		var lit: = candle(0.16 if centre else 0.12, centre)
		lit.node.position = Vector3(x, cup + 0.02, 0)
		root.add_child(lit.node)
		for light: OmniLight3D in lit.lights:
			light.light_energy = 1.8
			light.omni_range = 3.0
			lights.append(light)
	return {"node": root, "lights": lights}



static func books(rng: RandomNumberGenerator) -> Node3D:
	var root: = Node3D.new()
	var covers: Array[Color] = [Color(0.45, 0.08, 0.07), Color(0.3, 0.16, 0.08), Color(0.12, 0.2, 0.14), Color(0.38, 0.1, 0.12)]
	var y: = 0.0
	for i in rng.randi_range(2, 3):
		var size: = Vector3(rng.randf_range(0.3, 0.38), rng.randf_range(0.07, 0.1), rng.randf_range(0.22, 0.28))
		var book: = Node3D.new()
		book.position = Vector3(rng.randf_range(-0.02, 0.02), y, rng.randf_range(-0.02, 0.02))
		book.rotation.y = rng.randf_range(-0.35, 0.35)
		root.add_child(book)
		var cover: = covers[rng.randi_range(0, covers.size() - 1)]
		part(book, box_mesh(Vector3(size.x, 0.016, size.z)), leather(cover), Vector3(0, 0.008, 0))
		part(book, box_mesh(Vector3(size.x, 0.016, size.z)), leather(cover), Vector3(0, size.y - 0.008, 0))
		part(book, box_mesh(Vector3(0.02, size.y, size.z)), leather(cover), Vector3( - size.x * 0.5 + 0.01, size.y * 0.5, 0))
		part(book, box_mesh(Vector3(size.x - 0.028, size.y - 0.03, size.z - 0.02)), pages(), Vector3(0.008, size.y * 0.5, 0))
		part(book, box_mesh(Vector3(0.022, size.y * 0.7, 0.016)), gold(), Vector3( - size.x * 0.5 + 0.006, size.y * 0.5, size.z * 0.3))
		y += size.y
	return root


static func crate(size: float) -> Node3D:
	var root: = Node3D.new()
	part(root, box_mesh(Vector3.ONE * size), wood(Vector3.ONE * size * 0.5, 4.0, true), Vector3(0, size * 0.5, 0))
	return root



static func foliage(entries: Array, shape: int) -> MultiMeshInstance3D:
	var quad: = QuadMesh.new()
	quad.size = Vector2.ONE
	quad.center_offset = Vector3(0, -0.5, 0)
	var multimesh: = MultiMesh.new()
	multimesh.transform_format = MultiMesh.TRANSFORM_3D
	multimesh.use_colors = true
	multimesh.mesh = quad
	multimesh.instance_count = entries.size()
	for i in entries.size():
		multimesh.set_instance_transform(i, entries[i][0])
		multimesh.set_instance_color(i, entries[i][1])
	var node: = MultiMeshInstance3D.new()
	node.multimesh = multimesh
	var material: = ShaderMaterial.new()
	material.shader = _shader("res://shaders/foliage.gdshader")
	material.set_shader_parameter("shape", shape)
	node.material_override = material
	return node



static func leaf(rng: RandomNumberGenerator, at: Vector3, facing: Vector3, size: float, color: Color, sway: float) -> Array:
	var basis: = Basis.looking_at( - facing.normalized(), Vector3.UP)
	basis = basis * Basis(Vector3.FORWARD, rng.randf_range(-0.9, 0.9)) * Basis(Vector3.RIGHT, rng.randf_range(-0.5, 0.3))
	basis = basis.scaled(Vector3.ONE * size)
	return [Transform3D(basis, at), Color(color, sway)]



static func fallen_leaf(rng: RandomNumberGenerator, at: Vector3, size: float, color: Color) -> Array:
	var basis: = Basis(Vector3.UP, rng.randf_range(0.0, TAU)) * Basis(Vector3.RIGHT, - PI * 0.5 + rng.randf_range(-0.2, 0.2))
	basis = basis.scaled(Vector3.ONE * size)
	return [Transform3D(basis, at + Vector3(0, 0.004, 0)), Color(color, 0.0)]
