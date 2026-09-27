class_name RelicModels
extends RefCounted





const DAIS_TOP: = 0.08



static func build(id: String) -> Node3D:
	assert (Relics.exists(id), "Unknown relic: %s" % id)
	var root: = Node3D.new()
	root.name = "Model"
	match id:
		"desperado_ribbon":
			_desperado_ribbon(root)
		"kibitzers_whisper":
			_kibitzers_whisper(root)
		"appearance_fee":
			_appearance_fee(root)
		"brilliancy_prize":
			_brilliancy_prize(root)
		"fortress_stone":
			_fortress_stone(root)
		"clockmakers_key":
			_clockmakers_key(root)
		"ransom_ledger":
			_ransom_ledger(root)
		"knights_tour_chart":
			_knights_tour_chart(root)
		"fianchetto_glass":
			_fianchetto_glass(root)
		"castling_deed":
			_castling_deed(root)
		"queening_charter":
			_queening_charter(root)
		"salt_horn":
			_salt_horn(root)
		"forfeit_slip":
			_forfeit_slip(root)
		"opening_book":
			_opening_book(root)
		"annotators_quill":
			_annotators_quill(root)
		"patrons_chit":
			_patrons_chit(root)
		"sealed_move":
			_sealed_move(root)
		"grandmaster_norm":
			_grandmaster_norm(root)
		_:
			assert (false, "No model for relic %s" % id)
	return root



static func dais(rarity: String) -> Node3D:
	var metals: = {"common": ArenaProps.iron(), "uncommon": silver(), "rare": ArenaProps.gold()}
	assert (metals.has(rarity), "Unknown rarity: %s" % rarity)
	var root: = Node3D.new()
	root.name = "Dais"
	var turn: = Vector3(0, PI / 8.0, 0)
	_part(root, _cyl(0.175, 0.19, 0.036, 8), _slate(), Vector3(0, 0.018, 0), turn)
	_part(root, _cyl(0.172, 0.172, 0.02, 8), metals[rarity], Vector3(0, 0.046, 0), turn)
	_part(root, _cyl(0.155, 0.165, 0.024, 8), _slate(), Vector3(0, 0.068, 0), turn)
	return root




static func _mat(key: String, albedo: Color, roughness: float, metallic: = 0.0) -> StandardMaterial3D:
	return ArenaProps.standard("relic_" + key, albedo, roughness, metallic)


static func silver() -> StandardMaterial3D:
	return _mat("silver", Color(0.8, 0.8, 0.83), 0.24, 1.0)


static func _slate() -> StandardMaterial3D:
	return _mat("slate", Color(0.2, 0.2, 0.23), 0.55)


static func _keep_stone() -> StandardMaterial3D:
	return _mat("keep_stone", Color(0.6, 0.56, 0.5), 0.9)


static func _ivory() -> StandardMaterial3D:
	return _mat("ivory", Color(0.86, 0.78, 0.63), 0.42)


static func _obsidian() -> StandardMaterial3D:
	return _mat("obsidian", Color(0.07, 0.068, 0.08), 0.2)


static func _crimson() -> StandardMaterial3D:
	return _mat("crimson", Color(0.56, 0.05, 0.05), 0.6)


static func _crimson_dark() -> StandardMaterial3D:
	return _mat("crimson_dark", Color(0.34, 0.03, 0.04), 0.65)


static func _sealing_wax() -> StandardMaterial3D:
	return _mat("sealing_wax", Color(0.62, 0.06, 0.04), 0.3)


static func _porcelain() -> StandardMaterial3D:
	return _mat("porcelain", Color(0.94, 0.92, 0.88), 0.18)


static func _lacquer() -> StandardMaterial3D:
	return _mat("lacquer", Color(0.1, 0.06, 0.045), 0.28)


static func _ink() -> StandardMaterial3D:
	return _mat("ink", Color(0.015, 0.015, 0.02), 0.08)


static func _sepia() -> StandardMaterial3D:
	return _mat("sepia", Color(0.3, 0.17, 0.08), 0.8)


static func _wood() -> StandardMaterial3D:
	return _mat("wood", Color(0.36, 0.2, 0.1), 0.66)


static func _parchment() -> StandardMaterial3D:
	return _mat("parchment", Color(0.84, 0.72, 0.5), 0.85)


static func _card() -> StandardMaterial3D:
	return _mat("card", Color(0.9, 0.84, 0.7), 0.6)


static func _salt() -> StandardMaterial3D:
	return _mat("salt", Color(0.96, 0.96, 0.94), 0.35)


static func _feather() -> StandardMaterial3D:
	return _mat("feather", Color(0.93, 0.9, 0.84), 0.75)


static func _white() -> StandardMaterial3D:
	return _mat("white", Color(0.92, 0.9, 0.86), 0.6)


static func _velvet(color: Color) -> StandardMaterial3D:
	return _mat("velvet_" + color.to_html(), color, 0.95)


static func _dark_glass() -> StandardMaterial3D:
	return _mat("dark_glass", Color(0.05, 0.08, 0.12), 0.05, 0.3)




static func _lens() -> StandardMaterial3D:
	var material: = _mat("lens", Color(0.8, 0.9, 1.0, 0.2), 0.03)
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.emission_enabled = true
	material.emission = Color.BLACK
	material.cull_mode = BaseMaterial3D.CULL_DISABLED
	material.metallic_specular = 1.0
	return material



static func _jewel(key: String, color: Color) -> StandardMaterial3D:
	return _mat(key, color, 0.18)




static func _part(parent: Node3D, mesh: Mesh, material: Material, at: Vector3, rotation: = Vector3.ZERO, scale: = Vector3.ONE) -> MeshInstance3D:
	var node: = ArenaProps.part(parent, mesh, material, at, rotation)
	node.scale = scale
	return node


static func _group(parent: Node3D, at: Vector3, rotation: = Vector3.ZERO, scale: = 1.0) -> Node3D:
	var node: = Node3D.new()
	node.position = at
	node.rotation = rotation
	node.scale = Vector3.ONE * scale
	parent.add_child(node)
	return node


static func _box(size: Vector3) -> BoxMesh:
	return ArenaProps.box_mesh(size)


static func _cyl(top: float, bottom: float, height: float, segments: = 16) -> CylinderMesh:
	return ArenaProps.cylinder_mesh(top, bottom, height, segments)


static func _sphere(radius: float, segments: = 16) -> SphereMesh:
	var mesh: = SphereMesh.new()
	mesh.radius = radius
	mesh.height = radius * 2.0
	mesh.radial_segments = segments
	mesh.rings = maxi(4, segments / 2)
	return mesh



static func _torus(radius: float, thickness: float, rings: = 24) -> TorusMesh:
	var mesh: = TorusMesh.new()
	mesh.inner_radius = radius - thickness
	mesh.outer_radius = radius + thickness
	mesh.rings = rings
	mesh.ring_segments = 8
	return mesh



static func _piece(parent: Node3D, kind: String, material: Material, at: Vector3, height: float, rotation: = Vector3.ZERO, flatten: = 1.0) -> MeshInstance3D:
	var s: = height / PieceMeshes.height(kind)
	return _part(parent, PieceMeshes.get_mesh(kind, 0), material, at, rotation, Vector3(s, s, s * flatten))



static func _strip(parent: Node3D, a: Vector3, b: Vector3, width: float, material: Material) -> void :
	var delta: = b - a
	var length: = Vector2(delta.x, delta.z).length()
	_part(parent, _box(Vector3(length, 0.0014, width)), material, (a + b) * 0.5, Vector3(0, atan2( - delta.z, delta.x), 0))


static func _rng(key: String) -> RandomNumberGenerator:
	var rng: = RandomNumberGenerator.new()
	rng.seed = hash("relic-" + key)
	return rng




class _Geo:
	var st: = SurfaceTool.new()

	func _init() -> void :
		st.begin(Mesh.PRIMITIVE_TRIANGLES)


	func tri(a: Vector3, b: Vector3, c: Vector3, na: Vector3, nb: Vector3, nc: Vector3, ca: Color, cb: Color, cc: Color) -> void :
		var face: = (b - a).cross(c - a)
		if face.length_squared() < 1e-14:
			return
		var corners: Array = [[a, na, ca], [c, nc, cc], [b, nb, cb]] if face.dot(na + nb + nc) > 0.0 else [[a, na, ca], [b, nb, cb], [c, nc, cc]]
		for corner: Array in corners:
			st.set_color(corner[2])
			st.set_normal(corner[1])
			st.add_vertex(corner[0])

	func flat(a: Vector3, b: Vector3, c: Vector3, n: Vector3, color: = Color.WHITE) -> void :
		tri(a, b, c, n, n, n, color, color, color)

	func commit() -> ArrayMesh:
		return st.commit()



static func _slab(outline: PackedVector2Array, depth: float) -> ArrayMesh:
	var geo: = _Geo.new()
	var h: = depth * 0.5
	var indices: = Geometry2D.triangulate_polygon(outline)
	assert ( not indices.is_empty(), "relic outline does not triangulate")
	for i in range(0, indices.size(), 3):
		var a: = outline[indices[i]]
		var b: = outline[indices[i + 1]]
		var c: = outline[indices[i + 2]]
		for side: float in [1.0, -1.0]:
			geo.flat(Vector3(a.x, a.y, h * side), Vector3(b.x, b.y, h * side), Vector3(c.x, c.y, h * side), Vector3(0, 0, side))
	var area: = 0.0
	var count: = outline.size()
	for i in count:
		var p: = outline[i]
		var q: = outline[(i + 1) % count]
		area += p.x * q.y - q.x * p.y
	for i in count:
		var p: = outline[i]
		var q: = outline[(i + 1) % count]
		var edge: = q - p
		var out: = Vector2(edge.y, - edge.x).normalized() * signf(area)
		var n: = Vector3(out.x, out.y, 0.0)
		geo.flat(Vector3(p.x, p.y, h), Vector3(q.x, q.y, h), Vector3(q.x, q.y, - h), n)
		geo.flat(Vector3(p.x, p.y, h), Vector3(q.x, q.y, - h), Vector3(p.x, p.y, - h), n)
	return geo.commit()



static func _tube(path: PackedVector3Array, radii: PackedFloat32Array, colors: PackedColorArray, sides: = 10) -> ArrayMesh:
	var count: = path.size()
	assert (count >= 2 and radii.size() == count and colors.size() == count, "tube needs matching points, radii and colours")
	var geo: = _Geo.new()
	var rings: Array[PackedVector3Array] = []
	var normals: Array[PackedVector3Array] = []
	var normal: = Vector3.ZERO
	for i in count:
		var tangent: = (path[mini(i + 1, count - 1)] - path[maxi(i - 1, 0)]).normalized()
		if i == 0:
			normal = tangent.cross(Vector3.FORWARD if absf(tangent.z) < 0.9 else Vector3.RIGHT).normalized()
		else:
			normal = (normal - tangent * tangent.dot(normal)).normalized()
		var binormal: = tangent.cross(normal)
		var ring: = PackedVector3Array()
		var ring_normals: = PackedVector3Array()
		for k in sides:
			var angle: = TAU * k / sides
			var direction: = normal * cos(angle) + binormal * sin(angle)
			ring.append(path[i] + direction * radii[i])
			ring_normals.append(direction)
		rings.append(ring)
		normals.append(ring_normals)
	for i in count - 1:
		for k in sides:
			var k2: = (k + 1) % sides
			geo.tri(rings[i][k], rings[i][k2], rings[i + 1][k2], normals[i][k], normals[i][k2], normals[i + 1][k2], colors[i], colors[i], colors[i + 1])
			geo.tri(rings[i][k], rings[i + 1][k2], rings[i + 1][k], normals[i][k], normals[i + 1][k2], normals[i + 1][k], colors[i], colors[i + 1], colors[i + 1])
	var start_out: = (path[0] - path[1]).normalized()
	var end_out: = (path[count - 1] - path[count - 2]).normalized()
	for k in sides:
		var k2: = (k + 1) % sides
		geo.flat(path[0], rings[0][k], rings[0][k2], start_out, colors[0])
		geo.flat(path[count - 1], rings[count - 1][k], rings[count - 1][k2], end_out, colors[count - 1])
	return geo.commit()



static func _rod(parent: Node3D, a: Vector3, b: Vector3, radius: float, material: Material) -> void :
	var colors: = PackedColorArray([Color.WHITE, Color.WHITE])
	_part(parent, _tube(PackedVector3Array([a, b]), PackedFloat32Array([radius, radius]), colors, 8), material, Vector3.ZERO)



static func _leaf_outline(length: float, width: float, steps: = 6) -> PackedVector2Array:
	var points: = PackedVector2Array()
	for i in steps + 1:
		var t: = float(i) / steps
		points.append(Vector2(sin(PI * t) * width * 0.5 * (1.0 - t * 0.3), t * length))
	for i in range(steps - 1, 0, -1):
		var t: = float(i) / steps
		points.append(Vector2( - sin(PI * t) * width * 0.5 * (1.0 - t * 0.3), t * length))
	return points


static func _star_outline(points: int, outer: float, inner: float) -> PackedVector2Array:
	var out: = PackedVector2Array()
	for i in points * 2:
		var radius: = outer if i % 2 == 0 else inner
		var angle: = PI * 0.5 + PI * i / points
		out.append(Vector2(cos(angle), sin(angle)) * radius)
	return out



static func _tail_outline(width: float, length: float, notch: float) -> PackedVector2Array:
	var w: = width * 0.5
	return PackedVector2Array([Vector2( - w, 0), Vector2(w, 0), Vector2(w, - length), Vector2(0, - length + notch), Vector2( - w, - length)])



static func _shield_outline(width: float, height: float) -> PackedVector2Array:
	var w: = width * 0.5
	var shoulder: = height * 0.1
	var points: = PackedVector2Array([Vector2( - w, height * 0.5), Vector2(w, height * 0.5)])
	for i in 7:
		var angle: = PI * 0.5 * i / 6.0
		points.append(Vector2(w * cos(angle), shoulder - height * 0.6 * sin(angle)))
	for i in range(5, -1, -1):
		var angle: = PI * 0.5 * i / 6.0
		points.append(Vector2( - w * cos(angle), shoulder - height * 0.6 * sin(angle)))
	return points



static func _face_disc(parent: Node3D, radius: float, thickness: float, material: Material, at: Vector3, segments: = 24) -> void :
	_part(parent, _cyl(radius, radius, thickness, segments), material, at, Vector3(PI * 0.5, 0, 0))



static func _face_ring(parent: Node3D, radius: float, thickness: float, material: Material, at: Vector3) -> void :
	_part(parent, _torus(radius, thickness, 32), material, at, Vector3(PI * 0.5, 0, 0))





static func _desperado_ribbon(root: Node3D) -> void :
	_part(root, _cyl(0.035, 0.045, 0.016, 12), ArenaProps.iron(), Vector3(0, 0.008, -0.04))
	_rod(root, Vector3(0, 0.0, -0.04), Vector3(0, 0.25, -0.03), 0.007, ArenaProps.iron())
	var rosette: = _group(root, Vector3(0, 0.25, -0.012), Vector3(-0.45, 0, 0))
	for side: float in [-1.0, 1.0]:
		_part(rosette, _slab(_tail_outline(0.05, 0.21, 0.026), 0.006), _crimson(), Vector3(side * 0.022, -0.02, -0.014), Vector3(0, 0, side * 0.3))
	var outer: = _slab(PackedVector2Array([Vector2(-0.014, 0.036), Vector2(0.014, 0.036), Vector2(0.026, 0.1), Vector2(-0.026, 0.1)]), 0.006)
	var inner: = _slab(PackedVector2Array([Vector2(-0.011, 0.03), Vector2(0.011, 0.03), Vector2(0.018, 0.064), Vector2(-0.018, 0.064)]), 0.005)
	for i in 16:
		var angle: = TAU * i / 16.0
		var lifted: = 0.005 * (i % 2)
		_part(rosette, outer, _crimson() if i % 2 == 0 else _crimson_dark(), Vector3(0, 0, lifted), Vector3(0, 0, angle))
		_part(rosette, inner, _white(), Vector3(0, 0, 0.008 + lifted * 0.6), Vector3(0, 0, angle + PI / 16.0))
	_face_disc(rosette, 0.036, 0.014, ArenaProps.gold(), Vector3(0, 0, 0.016))
	_face_ring(rosette, 0.034, 0.004, ArenaProps.gold(), Vector3(0, 0, 0.023))
	_part(rosette, _slab(_star_outline(5, 0.022, 0.009), 0.005), ArenaProps.gold(), Vector3(0, 0, 0.025))



static func _kibitzers_whisper(root: Node3D) -> void :
	var gold: = ArenaProps.gold()
	_part(root, _cyl(0.05, 0.075, 0.022, 20), gold, Vector3(0, 0.011, 0))
	_part(root, _cyl(0.012, 0.018, 0.13, 10), gold, Vector3(0, 0.085, 0))
	_part(root, _sphere(0.02), gold, Vector3(0, 0.1, 0))
	_part(root, _cyl(0.045, 0.02, 0.03, 16), gold, Vector3(0, 0.165, 0))
	var eye: = _group(root, Vector3(0, 0.245, 0), Vector3(-0.55, 0, 0))
	_part(eye, _sphere(0.085, 24), _porcelain(), Vector3.ZERO)
	_part(eye, _sphere(0.042, 20), _jewel("iris", Color(0.3, 0.58, 1.0)), Vector3(0, 0, 0.07), Vector3.ZERO, Vector3(1, 1, 0.45))
	_part(eye, _sphere(0.02, 12), _ink(), Vector3(0, 0, 0.085), Vector3.ZERO, Vector3(1, 1, 0.4))
	_face_ring(eye, 0.093, 0.007, gold, Vector3.ZERO)
	for side: float in [-1.0, 1.0]:
		_part(eye, _sphere(0.012), gold, Vector3(side * 0.093, 0, 0))



static func _appearance_fee(root: Node3D) -> void :
	var rng: = _rng("appearance_fee")
	var gold: = ArenaProps.gold()
	var coin: = _cyl(0.046, 0.046, 0.012, 24)
	for stack: Array in [[Vector2(-0.075, -0.05), 7], [Vector2(0.005, -0.08), 4], [Vector2(0.08, 0.04), 2]]:
		var base: Vector2 = stack[0]
		var height: int = stack[1]
		for i in height:
			var at: = Vector3(base.x + rng.randf_range(-0.004, 0.004), 0.006 + i * 0.0125, base.y + rng.randf_range(-0.004, 0.004))
			_part(root, coin, gold, at)
		_part(root, _torus(0.04, 0.003), gold, Vector3(base.x, height * 0.0125 + 0.001, base.y))
	_part(root, coin, gold, Vector3(0.02, 0.006, 0.09), Vector3(0.12, 0, 0.1))
	var face: = _group(root, Vector3(-0.07, 0.047, 0.03), Vector3(-0.4, 0.15, 0))
	_face_disc(face, 0.046, 0.012, gold, Vector3.ZERO)
	_face_ring(face, 0.041, 0.003, gold, Vector3(0, 0, 0.006))
	_part(face, _slab(_star_outline(5, 0.024, 0.01), 0.004), gold, Vector3(0, 0, 0.007))
	var leather: = ArenaProps.leather(Color(0.33, 0.18, 0.09))
	_part(root, _sphere(0.058, 20), leather, Vector3(0.09, 0.05, -0.07), Vector3.ZERO, Vector3(1.0, 0.85, 1.0))
	_part(root, _cyl(0.02, 0.034, 0.03, 12), leather, Vector3(0.09, 0.105, -0.07))
	_part(root, _torus(0.022, 0.005), gold, Vector3(0.09, 0.106, -0.07))
	_part(root, _cyl(0.036, 0.018, 0.024, 12), leather, Vector3(0.09, 0.13, -0.07))



static func _brilliancy_prize(root: Node3D) -> void :
	var gold: = ArenaProps.gold()
	_rod(root, Vector3(0, 0.0, -0.09), Vector3(0, 0.2, -0.03), 0.005, gold)
	_part(root, _cyl(0.025, 0.03, 0.01, 12), gold, Vector3(0, 0.005, -0.09))
	var wreath: = _group(root, Vector3(0, 0.19, 0), Vector3(-0.4, 0, 0))
	var radius: = 0.115
	var leaf: = _slab(_leaf_outline(0.068, 0.032), 0.005)
	for side: float in [-1.0, 1.0]:
		var path: = PackedVector3Array()
		var radii: = PackedFloat32Array()
		var colors: = PackedColorArray()
		for i in 12:
			var t: = float(i) / 11.0
			var angle: = - PI * 0.5 + side * (0.06 + t * 2.62)
			path.append(Vector3(cos(angle), sin(angle), 0) * radius)
			radii.append(lerpf(0.0065, 0.003, t))
			colors.append(Color.WHITE)
		_part(wreath, _tube(path, radii, colors, 6), gold, Vector3.ZERO)
		for i in 12:
			var t: = (float(i) + 0.5) / 12.0
			var angle: = - PI * 0.5 + side * (0.12 + t * 2.5)
			var at: = Vector3(cos(angle), sin(angle), 0) * radius
			var travel: = Vector2( - sin(angle), cos(angle)) * side
			var heading: = atan2(travel.y, travel.x) - PI * 0.5
			var size: = lerpf(1.0, 0.62, t)
			_part(wreath, leaf, gold, at + Vector3(0, 0, 0.003), Vector3(0, 0, heading - side * 0.6), Vector3.ONE * size)
			_part(wreath, leaf, gold, at - Vector3(0, 0, 0.003), Vector3(0, 0, heading + side * 0.55), Vector3.ONE * size * 0.9)
		var tip_angle: = - PI * 0.5 + side * 2.72
		_part(wreath, _sphere(0.007), gold, Vector3(cos(tip_angle), sin(tip_angle), 0) * radius)
	var knot: = Vector3(0, - radius, 0.012)
	for side: float in [-1.0, 1.0]:
		_part(wreath, _torus(0.02, 0.006), _crimson(), knot + Vector3(side * 0.022, 0.004, 0), Vector3(PI * 0.5, 0, side * 0.3), Vector3(1.2, 1, 0.6))
		_part(wreath, _slab(_tail_outline(0.022, 0.07, 0.012), 0.004), _crimson(), knot + Vector3(side * 0.006, 0, -0.002), Vector3(0, 0, side * 0.35))
	_part(wreath, _sphere(0.012), _crimson(), knot + Vector3(0, 0, 0.004))



static func _fortress_stone(root: Node3D) -> void :
	var stone: = _keep_stone()
	var turn: = Vector3(0, PI / 8.0, 0)
	var at: = Vector3(-0.03, 0, -0.04)
	_part(root, _cyl(0.088, 0.098, 0.03, 8), stone, at + Vector3(0, 0.015, 0), turn)
	_part(root, _cyl(0.074, 0.08, 0.2, 8), stone, at + Vector3(0, 0.13, 0), turn)
	_part(root, _cyl(0.09, 0.078, 0.026, 8), stone, at + Vector3(0, 0.243, 0), turn)
	for i in 8:
		var angle: = TAU * i / 8.0 + PI / 8.0
		var spot: = at + Vector3(sin(angle) * 0.075, 0.272, cos(angle) * 0.075)
		_part(root, _box(Vector3(0.032, 0.034, 0.024)), stone, spot, Vector3(0, angle, 0))
	_part(root, _box(Vector3(0.04, 0.06, 0.02)), _lacquer(), at + Vector3(0, 0.06, 0.07))
	_part(root, _cyl(0.02, 0.02, 0.02, 12), _lacquer(), at + Vector3(0, 0.09, 0.07), Vector3(PI * 0.5, 0, 0))
	_part(root, _box(Vector3(0.012, 0.036, 0.02)), _lacquer(), at + Vector3(0, 0.175, 0.068))
	var shield: = _group(root, Vector3(0.07, 0.085, 0.07), Vector3(-0.3, 0.35, 0.06))
	_part(shield, _slab(_shield_outline(0.142, 0.172), 0.008), ArenaProps.gold(), Vector3(0, 0, -0.004))
	_part(shield, _slab(_shield_outline(0.128, 0.158), 0.012), silver(), Vector3.ZERO)
	_piece(shield, "rook", ArenaProps.gold(), Vector3(0, -0.05, 0.006), 0.1, Vector3.ZERO, 0.12)



static func _clockmakers_key(root: Node3D) -> void :
	var gold: = ArenaProps.gold()
	var body: = Vector3(0, 0.058, -0.04)
	_part(root, _box(Vector3(0.25, 0.1, 0.09)), _lacquer(), body)
	_part(root, _box(Vector3(0.26, 0.012, 0.1)), _lacquer(), body + Vector3(0, 0.054, 0))
	for x: float in [-0.11, 0.11]:
		for z: float in [-0.035, 0.035]:
			_part(root, _sphere(0.01), gold, Vector3(x, 0.008, body.z + z))
	_part(root, _box(Vector3(0.03, 0.012, 0.003)), gold, body + Vector3(0, -0.035, 0.046))
	for side: float in [-1.0, 1.0]:
		var face: = _group(root, body + Vector3(side * 0.058, 0.004, 0.046), Vector3(-0.15, 0, 0))
		_face_disc(face, 0.038, 0.006, _porcelain(), Vector3.ZERO)
		_face_ring(face, 0.04, 0.005, gold, Vector3(0, 0, 0.002))
		var minute: = 0.4 if side < 0.0 else -1.2
		var hour: = 2.2 if side < 0.0 else 0.9
		for hand: Array in [[minute, 0.03, 0.003], [hour, 0.02, 0.004]]:
			var angle: float = hand[0]
			var length: float = hand[1]
			_part(face, _box(Vector3(hand[2], length, 0.002)), _ink(), Vector3(sin(angle), cos(angle), 0) * length * 0.5 + Vector3(0, 0, 0.005), Vector3(0, 0, - angle))
		_part(face, _sphere(0.004), gold, Vector3(0, 0, 0.005))
		var pressed: = 0.008 if side < 0.0 else 0.0
		_part(root, _cyl(0.013, 0.015, 0.024, 12), gold, body + Vector3(side * 0.07, 0.072 - pressed, 0))
	var flag: = PackedVector2Array([Vector2(0, 0), Vector2(0.018, 0.008), Vector2(0, 0.016)])
	_part(root, _slab(flag, 0.002), _crimson(), body + Vector3(-0.058, 0.044, 0.05))
	var key: = _group(root, Vector3(0.0, 0.012, 0.1), Vector3(0, 0.18, 0))
	_part(key, _torus(0.038, 0.012), gold, Vector3(-0.13, 0, 0))
	_part(key, _sphere(0.016), gold, Vector3(-0.085, 0, 0))
	_part(key, _cyl(0.01, 0.01, 0.2, 10), gold, Vector3(0.01, 0, 0), Vector3(0, 0, PI * 0.5))
	_part(key, _torus(0.014, 0.004), gold, Vector3(-0.065, 0, 0), Vector3(0, 0, PI * 0.5))
	_part(key, _box(Vector3(0.044, 0.011, 0.046)), gold, Vector3(0.085, 0, 0.028))
	_part(key, _box(Vector3(0.013, 0.012, 0.018)), _lacquer(), Vector3(0.085, 0, 0.043))



static func _ransom_ledger(root: Node3D) -> void :
	var gold: = ArenaProps.gold()
	var green: = ArenaProps.leather(Color(0.1, 0.24, 0.14))
	var book: = _group(root, Vector3(0, 0, 0), Vector3(0, 0.22, 0))
	_part(book, _box(Vector3(0.24, 0.012, 0.18)), green, Vector3(0, 0.006, 0))
	_part(book, _box(Vector3(0.24, 0.012, 0.18)), green, Vector3(0, 0.058, 0))
	_part(book, _box(Vector3(0.014, 0.064, 0.18)), green, Vector3(-0.117, 0.032, 0))
	_part(book, _box(Vector3(0.226, 0.04, 0.17)), ArenaProps.pages(), Vector3(0.004, 0.032, 0))
	_part(book, _box(Vector3(0.016, 0.02, 0.07)), _parchment(), Vector3(-0.125, 0.034, 0))
	for z: float in [-0.084, 0.084]:
		_part(book, _box(Vector3(0.03, 0.015, 0.014)), gold, Vector3(0.107, 0.058, z))
		_part(book, _box(Vector3(0.014, 0.015, 0.03)), gold, Vector3(0.115, 0.058, z - signf(z) * 0.008))
	var crown: = _group(root, Vector3(0.02, 0.064, 0.0), Vector3(0, 0.3, 0))
	_crown(crown, 1.0)




static func _crown(parent: Node3D, scale: float) -> void :
	var gold: = ArenaProps.gold()
	var crown: = _group(parent, Vector3.ZERO, Vector3.ZERO, scale)
	_part(crown, _sphere(0.05, 16), _velvet(Color(0.5, 0.05, 0.07)), Vector3(0, 0.03, 0), Vector3.ZERO, Vector3(1, 0.75, 1))
	_part(crown, _cyl(0.056, 0.054, 0.034, 20), gold, Vector3(0, 0.017, 0))
	_part(crown, _torus(0.056, 0.004), gold, Vector3(0, 0.002, 0))
	_part(crown, _torus(0.057, 0.003), gold, Vector3(0, 0.033, 0))
	for i in 6:
		var angle: = TAU * i / 6.0
		var at: = Vector3(sin(angle) * 0.052, 0.054, cos(angle) * 0.052)
		_part(crown, _cyl(0.0, 0.013, 0.04, 6), gold, at)
		_part(crown, _sphere(0.0065), _porcelain(), at + Vector3(0, 0.022, 0))
		var gem: = Vector3(sin(angle + PI / 6.0) * 0.057, 0.018, cos(angle + PI / 6.0) * 0.057)
		_part(crown, _sphere(0.007), _jewel("ruby", Color(0.95, 0.1, 0.12)), gem)
	_part(crown, _sphere(0.01), gold, Vector3(0, 0.07, 0))
	_part(crown, _box(Vector3(0.005, 0.026, 0.005)), gold, Vector3(0, 0.086, 0))
	_part(crown, _box(Vector3(0.018, 0.005, 0.005)), gold, Vector3(0, 0.09, 0))



static func _knights_tour_chart(root: Node3D) -> void :
	var chart: = _group(root, Vector3(0, 0, 0.015), Vector3(0, -0.12, 0))
	_part(chart, _box(Vector3(0.27, 0.004, 0.19)), _parchment(), Vector3(0, 0.002, 0))
	_part(chart, _cyl(0.026, 0.026, 0.28, 16), _parchment(), Vector3(0, 0.026, -0.105), Vector3(0, 0, PI * 0.5))
	_part(chart, _torus(0.027, 0.004), _crimson(), Vector3(0.09, 0.026, -0.105), Vector3(0, 0, PI * 0.5))
	var cell: = 0.032
	var origin: = Vector3(-0.07, 0.0045, 0.012)
	for x in 5:
		for z in 5:
			if (x + z) % 2 == 1:
				_part(chart, _box(Vector3(cell, 0.0012, cell)), _sepia(), origin + Vector3((x - 2) * cell, 0, (z - 2) * cell))
	var tour: Array[Vector2i] = [Vector2i(0, 4), Vector2i(1, 2), Vector2i(3, 1), Vector2i(4, 3), Vector2i(2, 4), Vector2i(0, 3)]
	var ink: = _crimson()
	var lift: = Vector3(0, 0.0012, 0)
	for i in tour.size():
		var at: = origin + lift + Vector3((tour[i].x - 2) * cell, 0, (tour[i].y - 2) * cell)
		_part(chart, _cyl(0.005, 0.005, 0.0016, 10), ink, at)
		if i > 0:
			var from: = origin + lift + Vector3((tour[i - 1].x - 2) * cell, 0, (tour[i - 1].y - 2) * cell)
			_strip(chart, from, at, 0.0035, ink)
	_piece(chart, "knight", silver(), Vector3(0.085, 0.004, 0.015), 0.2, Vector3(0, -0.9, 0))



static func _fianchetto_glass(root: Node3D) -> void :
	var gold: = ArenaProps.gold()
	var board: = _group(root, Vector3(0.045, 0, -0.05), Vector3(0, -0.2, 0))
	var cell: = 0.042
	for x in 3:
		for z in 3:
			var diagonal: = x == z
			var material: Material = gold if diagonal else (_ivory() if (x + z) % 2 == 0 else _lacquer())
			_part(board, _box(Vector3(cell, 0.012, cell)), material, Vector3((x - 1) * cell, 0.006, (z - 1) * cell))
	_piece(board, "bishop", _ivory(), Vector3( - cell, 0.012, - cell), 0.2)
	var glass: = _group(root, Vector3(-0.005, 0.14, 0.085), Vector3(-0.4, 0, -0.9))
	_face_disc(glass, 0.064, 0.004, _lens(), Vector3.ZERO, 32)
	_face_ring(glass, 0.068, 0.008, gold, Vector3.ZERO)
	_part(glass, _cyl(0.011, 0.013, 0.026, 12), gold, Vector3(0, -0.086, 0))
	_part(glass, _cyl(0.012, 0.015, 0.11, 12), _lacquer(), Vector3(0, -0.154, 0))
	_part(glass, _sphere(0.014), gold, Vector3(0, -0.212, 0))



static func _castling_deed(root: Node3D) -> void :
	var gold: = ArenaProps.gold()
	var deed: = _group(root, Vector3(0, 0, 0.02), Vector3(0, -0.15, 0))
	_part(deed, _box(Vector3(0.2, 0.004, 0.15)), _parchment(), Vector3(0, 0.002, 0))
	for side: float in [-1.0, 1.0]:
		_part(deed, _cyl(0.02, 0.02, 0.16, 14), _parchment(), Vector3(side * 0.105, 0.02, 0), Vector3(PI * 0.5, 0, 0))
		for end: float in [-1.0, 1.0]:
			_part(deed, _sphere(0.009), gold, Vector3(side * 0.105, 0.02, end * 0.085))
	for i in 5:
		var length: = [0.13, 0.12, 0.13, 0.09, 0.06][i] as float
		_part(deed, _box(Vector3(length, 0.0012, 0.004)), _sepia(), Vector3(-0.08 + length * 0.5, 0.0045, -0.05 + i * 0.019))
	var seal: = Vector3(0.05, 0.009, 0.045)
	for side: float in [-1.0, 1.0]:
		_part(deed, _slab(_tail_outline(0.018, 0.075, 0.01), 0.003), _crimson(), seal + Vector3(side * 0.01, -0.004, 0), Vector3( - PI * 0.5, side * 0.35, 0))
	_part(deed, _cyl(0.028, 0.03, 0.01, 18), _sealing_wax(), seal)
	_part(deed, _torus(0.02, 0.003), _sealing_wax(), seal + Vector3(0, 0.005, 0))
	_piece(deed, "rook", _ivory(), Vector3(-0.045, 0.004, -0.01), 0.2)



static func _queening_charter(root: Node3D) -> void :
	var banner: = ArenaProps.banner(1.0, Color(0.12, 0.2, 0.45), Color(0.86, 0.63, 0.27))
	banner.scale = Vector3.ONE * 0.32
	banner.position = Vector3(-0.04, 0, -0.05)
	root.add_child(banner)
	_piece(root, "pawn", _ivory(), Vector3(0.1, 0, 0.06), 0.15)
	var crown: = _group(root, Vector3(0.1, 0.143, 0.06))
	_crown(crown, 0.36)



static func _salt_horn(root: Node3D) -> void :
	var gold: = ArenaProps.gold()
	var path: = PackedVector3Array()
	var radii: = PackedFloat32Array()
	var colors: = PackedColorArray()
	var centre: = Vector2(0.0, 0.18)
	var bend: = 0.15
	var steps: = 16
	for i in steps + 1:
		var t: = float(i) / steps
		var angle: = deg_to_rad(lerpf(205.0, 338.0, t))
		path.append(Vector3(centre.x + cos(angle) * bend, centre.y + sin(angle) * bend, sin(t * PI) * 0.02))
		radii.append(lerpf(0.046, 0.006, pow(t, 0.85)))
		colors.append(Color.WHITE)
	var lowest: = INF
	for i in path.size():
		lowest = minf(lowest, path[i].y - radii[i])
	var horn: = _group(root, Vector3(0.02, 0.003 - lowest, -0.03), Vector3(0, 0.25, 0))

	var split: = 11
	_part(horn, _tube(path.slice(0, split + 1), radii.slice(0, split + 1), colors.slice(0, split + 1), 14), _mat("horn", Color(0.84, 0.75, 0.57), 0.4), Vector3.ZERO)
	_part(horn, _tube(path.slice(split), radii.slice(split), colors.slice(split), 14), _mat("horn_tip", Color(0.27, 0.18, 0.11), 0.35), Vector3.ZERO)
	for index: int in [0, 9]:
		var tangent: = (path[index + 1] - path[index]).normalized()
		var band: = _part(horn, _torus(radii[index] + 0.001, 0.005 if index == 0 else 0.003), gold, path[index])
		band.basis = Basis(Quaternion(Vector3.UP, tangent)) * Basis.from_scale(band.scale)
	var mouth_out: = (path[0] - path[1]).normalized()
	var fill: = _part(horn, _cyl(0.04, 0.04, 0.006, 16), _salt(), path[0] + mouth_out * 0.001)
	fill.basis = Basis(Quaternion(Vector3.UP, mouth_out))
	_part(horn, _sphere(0.009), gold, path[steps])
	var mouth: = horn.position + path[0].rotated(Vector3.UP, 0.25)
	var pile: = Vector3(mouth.x - 0.01, 0.0, mouth.z + 0.06)
	_part(root, _cyl(0.006, 0.058, 0.034, 14), _salt(), pile + Vector3(0, 0.017, 0))
	var rng: = _rng("salt_horn")
	for i in 14:
		var spread: = Vector3(rng.randf_range(-0.07, 0.07), 0, rng.randf_range(-0.05, 0.07))
		var size: = rng.randf_range(0.007, 0.013)
		var crystal: = pile + spread + Vector3(0, size * 0.5, 0)
		_part(root, _box(Vector3.ONE * size), _salt(), crystal, Vector3(rng.randf() * TAU, rng.randf() * TAU, rng.randf() * TAU))



static func _forfeit_slip(root: Node3D) -> void :
	var slip: = _group(root, Vector3(0.0, 0.0, 0.01), Vector3(0, -0.2, 0))
	_part(slip, _box(Vector3(0.25, 0.004, 0.17)), _card(), Vector3(0, 0.002, 0))
	var face: = _group(slip, Vector3(-0.06, 0.004, 0.0), Vector3( - PI * 0.5, 0, 0))
	var stamp: = _crimson()
	_face_ring(face, 0.05, 0.005, stamp, Vector3.ZERO)
	_piece(face, "pawn", stamp, Vector3(0, -0.036, 0.0), 0.07, Vector3.ZERO, 0.04)
	_part(face, _box(Vector3(0.1, 0.008, 0.002)), stamp, Vector3(0, 0, 0.001), Vector3(0, 0, -0.75))
	for i in 4:
		var length: = 0.06 if i % 2 == 0 else 0.045
		_part(slip, _box(Vector3(length, 0.0012, 0.005)), _sepia(), Vector3(0.045 + length * 0.5, 0.0045, -0.05 + i * 0.022))
	_piece(root, "pawn", _obsidian(), Vector3(0.03, 0.068, 0.05), 0.14, Vector3(0, 0.15, - PI * 0.5 - 0.2))



static func _opening_book(root: Node3D) -> void :
	var wedge: = PackedVector2Array([Vector2(-0.09, 0.0), Vector2(0.08, 0.0), Vector2(0.08, 0.075), Vector2(-0.09, 0.008)])
	_part(root, _slab(wedge, 0.2), _wood(), Vector3(0, 0, 0), Vector3(0, PI * 0.5, 0))
	var book: = _group(root, Vector3(0, 0.05, -0.002), Vector3(0.41, 0, 0))
	var brown: = ArenaProps.leather(Color(0.36, 0.14, 0.07))
	for side: float in [-1.0, 1.0]:
		var half: = _group(book, Vector3(side * 0.066, 0, 0), Vector3(0, 0, side * 0.07))
		_part(half, _box(Vector3(0.13, 0.008, 0.18)), brown, Vector3(side * 0.002, 0, 0))
		_part(half, _box(Vector3(0.122, 0.016, 0.17)), ArenaProps.pages(), Vector3(0, 0.012, 0))
		for i in 7:
			if side > 0.0 and i >= 2 and i <= 5:
				continue
			var length: = 0.09 if i % 3 != 2 else 0.06
			_part(half, _box(Vector3(length, 0.0012, 0.0035)), _sepia(), Vector3( - side * 0.004 + (length - 0.09) * 0.5, 0.0205, -0.066 + i * 0.022))
		if side > 0.0:
			var cell: = 0.017
			for x in 4:
				for z in 4:
					var dark: = (x + z) % 2 == 1
					_part(half, _box(Vector3(cell, 0.0012, cell)), _sepia() if dark else _card(), Vector3((x - 1.5) * cell, 0.0205, (z - 1.5) * cell + 0.012))
	_part(book, _box(Vector3(0.012, 0.004, 0.064)), _crimson(), Vector3(0, 0.021, 0.056))
	_part(book, _slab(_tail_outline(0.012, 0.03, 0.006), 0.003), _crimson(), Vector3(0, 0.02, 0.089), Vector3(-0.41, 0, 0))



static func _annotators_quill(root: Node3D) -> void :
	var gold: = ArenaProps.gold()
	var sheet: = _group(root, Vector3(0.03, 0, 0.03), Vector3(0, 0.3, 0))
	_part(sheet, _box(Vector3(0.2, 0.003, 0.15)), ArenaProps.pages(), Vector3(0, 0.0015, 0))
	for i in 5:
		var length: = 0.14 if i % 2 == 0 else 0.11
		_part(sheet, _box(Vector3(length, 0.0012, 0.0035)), _sepia(), Vector3(-0.07 + length * 0.5, 0.0035, -0.05 + i * 0.024))
	var well: = Vector3(-0.06, 0.003, -0.04)
	_part(root, _cyl(0.046, 0.05, 0.05, 18), _dark_glass(), well + Vector3(0, 0.025, 0))
	_part(root, _cyl(0.024, 0.046, 0.018, 18), _dark_glass(), well + Vector3(0, 0.059, 0))
	_part(root, _cyl(0.022, 0.022, 0.014, 16), _dark_glass(), well + Vector3(0, 0.075, 0))
	_part(root, _torus(0.023, 0.004), gold, well + Vector3(0, 0.082, 0))
	_part(root, _cyl(0.018, 0.018, 0.002, 16), _ink(), well + Vector3(0, 0.081, 0))
	var quill: = _group(root, well + Vector3(0, 0.07, 0), Vector3(-0.2, 0, -0.38))
	var shaft: = PackedVector3Array()
	var radii: = PackedFloat32Array()
	var colors: = PackedColorArray()
	for i in 9:
		var t: = float(i) / 8.0
		shaft.append(Vector3(0.022 * t * t, -0.03 + 0.33 * t, 0))
		radii.append(lerpf(0.0035, 0.0012, t))
		colors.append(Color.WHITE)
	_part(quill, _tube(shaft, radii, colors, 8), _feather(), Vector3.ZERO)
	_part(quill, _cyl(0.0, 0.004, 0.02, 8), gold, Vector3(0, -0.04, 0), Vector3(PI, 0, 0))
	var vane: = PackedVector2Array([Vector2(0.0, 0.06), Vector2(0.012, 0.08), Vector2(0.02, 0.11), Vector2(0.025, 0.14), 
		Vector2(0.017, 0.152), Vector2(0.027, 0.168), Vector2(0.029, 0.2), Vector2(0.025, 0.24), Vector2(0.016, 0.27), 
		Vector2(0.004, 0.296)])
	var bend: = func(points: PackedVector2Array, width: float) -> PackedVector2Array:
		var out: = PackedVector2Array()
		for point in points:
			var t: = clampf((point.y + 0.03) / 0.33, 0.0, 1.0)
			out.append(Vector2(point.x * width + 0.022 * t * t, point.y))
		var spine: = PackedVector2Array()
		for i in range(points.size() - 1, -1, -1):
			var t: = clampf((points[i].y + 0.03) / 0.33, 0.0, 1.0)
			spine.append(Vector2(0.022 * t * t, points[i].y))
		out.append_array(spine.slice(1, spine.size() - 1))
		return out
	_part(quill, _slab(bend.call(vane, 1.0), 0.0025), _feather(), Vector3(0, 0, 0.0), Vector3(0, -0.25, 0))
	_part(quill, _slab(bend.call(vane, -0.7), 0.0025), _feather(), Vector3(0, 0, 0.0), Vector3(0, 0.25, 0))



static func _patrons_chit(root: Node3D) -> void :
	var gold: = ArenaProps.gold()
	_part(root, _box(Vector3(0.19, 0.035, 0.06)), _wood(), Vector3(0, 0.0175, -0.04))
	_part(root, _box(Vector3(0.17, 0.002, 0.012)), _ink(), Vector3(0, 0.0355, -0.04))
	var card: = _group(root, Vector3(0, 0.09, -0.04), Vector3(-0.22, 0, 0))
	_part(card, _box(Vector3(0.16, 0.11, 0.006)), _card(), Vector3.ZERO)
	for y: float in [-0.048, 0.048]:
		_part(card, _box(Vector3(0.148, 0.005, 0.002)), gold, Vector3(0, y, 0.0035))
	for x: float in [-0.072, 0.072]:
		_part(card, _box(Vector3(0.005, 0.1, 0.002)), gold, Vector3(x, 0, 0.0035))
	_piece(card, "pawn", gold, Vector3(0, -0.034, 0.003), 0.066, Vector3.ZERO, 0.08)
	for side: float in [-1.0, 1.0]:
		_part(card, _slab(_star_outline(5, 0.012, 0.005), 0.002), _crimson(), Vector3(side * 0.045, 0.01, 0.004))
	for token: Array in [[Vector3(0.05, 0.0, 0.07), 0.3], [Vector3(-0.04, 0.0, 0.085), -0.5]]:
		var coin: = _group(root, token[0], Vector3(0, token[1], 0))
		_part(coin, _cyl(0.034, 0.034, 0.008, 24), gold, Vector3(0, 0.004, 0))
		_part(coin, _torus(0.029, 0.0025), gold, Vector3(0, 0.008, 0))
		_part(coin, _box(Vector3(0.012, 0.0024, 0.012)), _ink(), Vector3(0, 0.0078, 0), Vector3(0, PI * 0.25, 0))



static func _sealed_move(root: Node3D) -> void :
	_part(root, _box(Vector3(0.21, 0.025, 0.055)), _wood(), Vector3(0, 0.0125, -0.04))
	var envelope: = _group(root, Vector3(0, 0.083, -0.035), Vector3(-0.32, 0, 0))
	_part(envelope, _box(Vector3(0.2, 0.13, 0.007)), ArenaProps.pages(), Vector3.ZERO)
	var flap: = PackedVector2Array([Vector2(-0.1, 0.065), Vector2(0.1, 0.065), Vector2(0.0, -0.012)])
	_part(envelope, _slab(flap, 0.003), _card(), Vector3(0, 0, 0.005))
	for side: float in [-1.0, 1.0]:
		var fold: = PackedVector2Array([Vector2(side * 0.1, -0.065), Vector2(side * 0.1, -0.058), Vector2(side * 0.02, 0.0), Vector2(side * 0.012, -0.002)])
		_part(envelope, _slab(fold, 0.002), _card(), Vector3(0, 0, 0.004))
	_face_disc(envelope, 0.026, 0.008, _sealing_wax(), Vector3(0, -0.006, 0.009))
	_face_ring(envelope, 0.018, 0.0025, _sealing_wax(), Vector3(0, -0.006, 0.013))
	_piece(envelope, "king", _sealing_wax(), Vector3(0, -0.018, 0.013), 0.026, Vector3.ZERO, 0.15)



static func _grandmaster_norm(root: Node3D) -> void :
	var gold: = ArenaProps.gold()
	var outside: = ArenaProps.leather(Color(0.06, 0.06, 0.08))
	var velvet: = _velvet(Color(0.1, 0.16, 0.42))
	var case: = _group(root, Vector3(0, 0, 0.0), Vector3(0, -0.1, 0))
	_part(case, _box(Vector3(0.2, 0.04, 0.15)), outside, Vector3(0, 0.02, 0))
	_part(case, _box(Vector3(0.184, 0.004, 0.134)), velvet, Vector3(0, 0.041, 0))
	var lid: = _group(case, Vector3(0, 0.04, -0.075), Vector3(-1.85, 0, 0))
	_part(lid, _box(Vector3(0.2, 0.02, 0.15)), outside, Vector3(0, 0.01, 0.075))
	_part(lid, _box(Vector3(0.184, 0.003, 0.134)), velvet, Vector3(0, -0.001, 0.075))
	_part(lid, _box(Vector3(0.05, 0.003, 0.008)), gold, Vector3(0, -0.003, 0.14))
	var medal: = _group(case, Vector3(0, 0.06, 0.012), Vector3(-0.95, 0, 0))
	for side: float in [-1.0, 1.0]:
		var ribbon: = _group(medal, Vector3(side * 0.012, 0.04, -0.004), Vector3(0, 0, side * -0.28))
		_part(ribbon, _box(Vector3(0.026, 0.07, 0.003)), _crimson(), Vector3(0, 0.035, 0))
		_part(ribbon, _box(Vector3(0.007, 0.07, 0.0034)), _white(), Vector3(0, 0.035, 0))
	_part(medal, _torus(0.008, 0.0025), gold, Vector3(0, 0.052, 0), Vector3(PI * 0.5, 0, 0))
	_face_disc(medal, 0.05, 0.01, gold, Vector3.ZERO, 28)
	_face_ring(medal, 0.046, 0.004, gold, Vector3(0, 0, 0.005))
	_part(medal, _slab(_star_outline(5, 0.032, 0.014), 0.006), gold, Vector3(0, 0, 0.006))
