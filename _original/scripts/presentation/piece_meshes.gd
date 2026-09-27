class_name PieceMeshes
extends RefCounted











const KINDS: PackedStringArray = ["pawn", "knight", "bishop", "rook", "queen", "king"]
const MAX_TIER: = 3

const SIDES: = 12
const BEVEL: = 0.16

const ROUND: = 24

const CREVICE: = 0.6

const _HEIGHT: = {"pawn": 0.74, "knight": 1.03, "bishop": 1.05, "rook": 0.9, "queen": 1.13, "king": 1.24}
const _RADIUS: = {"pawn": 0.34, "knight": 0.36, "bishop": 0.35, "rook": 0.36, "queen": 0.37, "king": 0.38}

const STONE: = Color(0.0, 0.0, 0.0, 1.0)
const TRIM: = Color(1.0, 0.0, 0.0, 1.0)
const CLOTH: = Color(0.0, 1.0, 0.0, 1.0)
const GEM: = Color(0.0, 0.0, 1.0, 1.0)
const GEM_DIM: = Color(0.0, 0.0, 0.35, 1.0)
const GLOW_TRIM: = Color(1.0, 0.0, 0.8, 1.0)
const CARVED: = Color(0.0, 0.0, 0.0, 0.1)

static var _meshes: Dictionary = {}



static func get_mesh(kind: String, tier: int) -> ArrayMesh:
	assert (KINDS.has(kind) and tier >= 0 and tier <= MAX_TIER, "no piece mesh for %s tier %d" % [kind, tier])
	var key: = "%s:%d" % [kind, tier]
	if not _meshes.has(key):
		var m: = _Mesh.new()
		match kind:
			"pawn":
				_pawn(m, tier)
			"rook":
				_rook(m, tier)
			"knight":
				_knight(m, tier)
			"bishop":
				_bishop(m, tier)
			"queen":
				_queen(m, tier)
			"king":
				_king(m, tier)
		_meshes[key] = m.commit(_HEIGHT[kind])
	return _meshes[key]



static func height(kind: String) -> float:
	return _HEIGHT[kind]


static func base_radius(kind: String) -> float:
	return _RADIUS[kind]







static func _foot(r: float, tier: int) -> _Profile:
	var line: = TRIM if tier >= 2 else STONE
	var p: = _Profile.new(Vector2(0.0, 0.0))
	p.to(Vector2(r - 0.014, 0.0))
	p.to(Vector2(r, 0.014))
	p.to(Vector2(r, 0.05))
	p.paint(line)
	p.to(Vector2(r - 0.016, 0.066))
	p.paint(STONE)
	p.to(Vector2(r - 0.046, 0.066))
	p.to(Vector2(r - 0.046, 0.097))
	p.paint(line)
	p.to(Vector2(r - 0.06, 0.111))
	p.paint(STONE)
	p.to(Vector2(r - 0.084, 0.111))
	p.paint(TRIM if tier >= 1 else STONE)
	p.arc(Vector2(r - 0.084, 0.1295), 0.0185, -90.0, 90.0)
	p.paint(STONE)
	p.to(Vector2(r - 0.11, 0.148))
	return p



static func _collar(p: _Profile, r: float, y: float, tier: int) -> void :
	p.paint(GLOW_TRIM if tier >= 3 else (TRIM if tier >= 1 else STONE))
	p.to(Vector2(r, y))
	p.to(Vector2(r + 0.012, y + 0.012))
	p.to(Vector2(r + 0.012, y + 0.027))
	p.to(Vector2(r - 0.002, y + 0.039))
	p.paint(STONE)



static func _studs(m: _Mesh, r: float, color: Color) -> void :
	for i in 4:
		var a: = TAU * (i + 0.5) / 4.0
		var out: = Vector3(sin(a), 0.0, - cos(a))
		_gem(m, out * (r * 0.99) + Vector3.UP * 0.032, out, 0.022, color)


static func _pawn(m: _Mesh, tier: int) -> void :
	var r: float = _RADIUS["pawn"]
	var p: = _foot(r, tier)
	p.curve(Vector2(0.205, 0.2), Vector2(0.112, 0.31), Vector2(0.096, 0.42))
	_collar(p, 0.15, 0.428, tier)
	p.to(Vector2(0.086, 0.472))
	p.to(Vector2(0.08, 0.5))
	p.to(Vector2(0.0, 0.5))
	_lathe(m, p, SIDES)
	_ball(m, Vector3(0.0, 0.615, 0.0), 0.125, GLOW_TRIM if tier >= 3 else STONE)
	if tier >= 3:
		_studs(m, r, TRIM)


static func _rook(m: _Mesh, tier: int) -> void :
	var r: float = _RADIUS["rook"]
	var p: = _foot(r, tier)
	p.to(Vector2(0.245, 0.16))
	p.paint(TRIM if tier >= 2 else STONE)
	p.to(Vector2(0.244, 0.198))
	p.paint(STONE)
	p.curve(Vector2(0.236, 0.32), Vector2(0.212, 0.5), Vector2(0.206, 0.598))
	_collar(p, 0.212, 0.598, tier)
	p.curve(Vector2(0.24, 0.66), Vector2(0.27, 0.69), Vector2(0.276, 0.74))
	p.paint(TRIM if tier >= 3 else STONE)
	p.to(Vector2(0.276, 0.8))
	p.paint(STONE)
	p.to(Vector2(0.2, 0.8))
	p.to(Vector2(0.2, 0.772))
	p.to(Vector2(0.0, 0.772))
	var tabard: = {}
	if tier >= 2:
		tabard = {"facets": [0, 6], "y0": 0.22, "y1": 0.57, "color": CLOTH, "edge": TRIM}
	_lathe(m, p, SIDES, Transform3D.IDENTITY, tabard)

	for i in 6:
		var a: = TAU * i / 6.0
		var basis: = Basis(Vector3.UP, - a)
		var centre: = basis * Vector3(0.0, 0.85, -0.238)
		_block(m, centre, Vector3(0.066, 0.05, 0.037), TRIM if tier >= 3 else STONE, basis)
	if tier >= 3:
		_studs(m, r, TRIM)


static func _bishop(m: _Mesh, tier: int) -> void :
	var r: float = _RADIUS["bishop"]
	var p: = _foot(r, tier)
	p.curve(Vector2(0.222, 0.26), Vector2(0.116, 0.42), Vector2(0.1, 0.56))
	_collar(p, 0.15, 0.566, tier)
	p.to(Vector2(0.09, 0.612))
	p.to(Vector2(0.086, 0.64))
	p.to(Vector2(0.0, 0.64))
	var tabard: = {}
	if tier >= 2:
		tabard = {"facets": [0, 6], "y0": 0.17, "y1": 0.54, "color": CLOTH, "edge": TRIM}
	_lathe(m, p, SIDES, Transform3D.IDENTITY, tabard)

	var crystal: = tier >= 3
	var mitre: = _Profile.new(Vector2(0.0, 0.636))
	mitre.paint(TRIM if tier >= 2 else STONE)
	mitre.to(Vector2(0.09, 0.636))
	mitre.to(Vector2(0.106, 0.652))
	mitre.paint(GEM if crystal else STONE)
	mitre.curve(Vector2(0.126, 0.672), Vector2(0.136, 0.73), Vector2(0.124, 0.79))
	mitre.curve(Vector2(0.11, 0.87), Vector2(0.05, 0.96), Vector2(0.0, 1.05))
	var ribs: = {"ribs": [0.652, 1.05], "color": TRIM} if crystal else {}
	_lathe(m, mitre, SIDES, Transform3D.IDENTITY, ribs)

	for side in [-1.0, 1.0]:
		var face: = _facet_distance(0.118, SIDES) + 0.003
		_decal(m, Vector3(0.0, 0.83, face * side), Vector3(0.0, 0.22, side), 0.024, 0.052, TRIM if crystal else CARVED)
	if tier >= 3:
		_studs(m, r, TRIM)


static func _queen(m: _Mesh, tier: int) -> void :
	var r: float = _RADIUS["queen"]
	var p: = _foot(r, tier)
	p.curve(Vector2(0.24, 0.3), Vector2(0.126, 0.48), Vector2(0.11, 0.62))
	_collar(p, 0.165, 0.626, tier)
	p.to(Vector2(0.118, 0.672))
	p.curve(Vector2(0.12, 0.75), Vector2(0.15, 0.81), Vector2(0.19, 0.84))
	p.paint(TRIM if tier >= 2 else STONE)
	p.to(Vector2(0.2, 0.85))
	p.to(Vector2(0.2, 0.9))
	p.to(Vector2(0.186, 0.912))
	p.paint(STONE)
	p.to(Vector2(0.15, 0.912))
	p.curve(Vector2(0.14, 0.96), Vector2(0.08, 0.99), Vector2(0.0, 0.995))
	var tabard: = {}
	if tier >= 2:
		tabard = {"facets": [0, 6], "y0": 0.18, "y1": 0.6, "color": CLOTH, "edge": TRIM}
	_lathe(m, p, SIDES, Transform3D.IDENTITY, tabard)

	var spike_color: = TRIM if tier >= 3 else STONE
	var pearl_color: = TRIM if tier >= 2 else STONE
	for i in 8:
		var a: = TAU * (i + 0.5) / 8.0
		var out: = Vector3(sin(a), 0.0, - cos(a))
		var side: = out.cross(Vector3.UP)
		var root: = out * 0.183 + Vector3.UP * 0.9
		var tip: = out * 0.2 + Vector3.UP * (1.0 if i % 2 == 0 else 0.975)
		_pyramid(m, [root + side * 0.034 - out * 0.018, root + side * 0.034 + out * 0.02, root - side * 0.034 + out * 0.02, root - side * 0.034 - out * 0.018], tip, spike_color)
		_ball(m, tip + Vector3.UP * 0.012, 0.021, pearl_color)
	_ball(m, Vector3(0.0, 1.03, 0.0), 0.046, GLOW_TRIM if tier >= 3 else pearl_color)
	var finial: = Vector3(0.0, 1.07, 0.0)
	_pyramid(m, [finial + Vector3(0.02, 0, 0), finial + Vector3(0, 0, 0.02), finial + Vector3(-0.02, 0, 0), finial + Vector3(0, 0, -0.02)], Vector3(0.0, 1.13, 0.0), pearl_color)
	var gem_color: = GEM if tier >= 2 else TRIM
	for side in [-1.0, 1.0]:
		_gem(m, Vector3(0.0, 0.875, 0.197 * side), Vector3(0.0, 0.0, side), 0.034 if tier >= 3 else 0.026, gem_color)
	if tier >= 3:
		_studs(m, r, TRIM)


static func _king(m: _Mesh, tier: int) -> void :
	var r: float = _RADIUS["king"]
	var p: = _foot(r, tier)
	p.curve(Vector2(0.25, 0.32), Vector2(0.132, 0.52), Vector2(0.12, 0.66))
	_collar(p, 0.175, 0.666, tier)
	p.to(Vector2(0.126, 0.712))
	p.curve(Vector2(0.13, 0.8), Vector2(0.17, 0.88), Vector2(0.2, 0.92))
	p.paint(TRIM if tier >= 2 else STONE)
	p.to(Vector2(0.21, 0.93))
	p.to(Vector2(0.21, 0.965))
	p.to(Vector2(0.19, 0.98))
	p.paint(STONE)
	p.to(Vector2(0.07, 0.98))
	p.to(Vector2(0.07, 1.0))
	p.to(Vector2(0.0, 1.0))
	var tabard: = {}
	if tier >= 2:
		tabard = {"facets": [0, 3, 6, 9], "y0": 0.18, "y1": 0.63, "color": CLOTH, "edge": TRIM}
	_lathe(m, p, SIDES, Transform3D.IDENTITY, tabard)
	var cross: = TRIM if tier >= 2 else STONE
	_block(m, Vector3(0.0, 1.115, 0.0), Vector3(0.03, 0.125, 0.03), cross)
	_block(m, Vector3(0.0, 1.16, 0.0), Vector3(0.088, 0.03, 0.03), cross)
	if tier >= 2:
		for side in [-1.0, 1.0]:
			_gem(m, Vector3(0.0, 0.86, _facet_distance(0.172, SIDES) * side + 0.004 * side), Vector3(0.0, 0.25, side), 0.036 if tier >= 3 else 0.028, GEM)
	if tier >= 3:
		_studs(m, r, TRIM)






const _NECK: Array[Vector4] = [
	Vector4(0.27, 0.0, 0.16, 0.2), Vector4(0.36, -0.015, 0.155, 0.195), Vector4(0.46, -0.005, 0.14, 0.165), 
	Vector4(0.56, 0.015, 0.13, 0.125), Vector4(0.65, 0.03, 0.125, 0.1), Vector4(0.74, 0.04, 0.118, 0.077), 
	Vector4(0.82, 0.03, 0.105, 0.062), Vector4(0.88, 0.02, 0.08, 0.042), 
]


const _HEAD: Array[Array] = [
	[0.05, 0.855, 0.07, 0.05, 0.05], [0.02, 0.855, 0.1, 0.08, 0.09], [-0.03, 0.845, 0.118, 0.085, 0.125], 
	[-0.09, 0.825, 0.112, 0.075, 0.11], [-0.15, 0.795, 0.098, 0.066, 0.078], [-0.21, 0.76, 0.088, 0.06, 0.058], 
	[-0.26, 0.73, 0.084, 0.058, 0.052], [-0.3, 0.71, 0.08, 0.055, 0.048], [-0.325, 0.7, 0.062, 0.044, 0.038], 
]
const _LOFT_POINTS: = 12
const _LOFT_POWER: = 2.3


static func _knight(m: _Mesh, tier: int) -> void :
	var r: float = _RADIUS["knight"]
	var p: = _foot(r, tier)
	p.curve(Vector2(0.24, 0.18), Vector2(0.21, 0.22), Vector2(0.2, 0.238))
	_collar(p, 0.206, 0.238, tier)
	p.to(Vector2(0.0, 0.277))
	_lathe(m, p, SIDES)

	var neck: Array = []
	for s in _NECK:
		neck.append(_ring_xz(s.x, s.y, s.z, s.w))
	_loft(m, neck, STONE, true, true)
	var head: Array = []
	for s in _HEAD:
		head.append(_ring_xy(s[0], s[1], s[2], s[3], s[4]))
	_loft(m, head, STONE, true, true)


	for side in [-1.0, 1.0]:
		var base: = Vector3(0.052 * side, 0.924, 0.004)
		_pyramid(m, [base + Vector3(0, 0, -0.028), base + Vector3(0.022 * side, 0, 0), base + Vector3(0, 0, 0.028), base + Vector3(-0.022 * side, 0, 0)], 
			Vector3(0.066 * side, 1.03, 0.04), STONE)


	var mane: = GEM if tier >= 3 else (CLOTH if tier >= 2 else STONE)
	var crest: Array[Vector3] = []
	for s in _NECK.slice(0, 7):
		crest.append(Vector3(0.0, s.x, s.y + s.w - 0.012))
	crest.append(Vector3(0.0, 0.915, 0.055))
	for k in crest.size() - 1:
		var a: Vector3 = crest[k]
		var b: Vector3 = crest[k + 1]
		var along: = (b - a).normalized()
		var outward: = Vector3(0.0, - along.z, along.y) if along.y > 0.0 else Vector3(0.0, along.z, - along.y)
		if outward.z < 0.0:
			outward = - outward

		var reach: = (0.05 if k % 2 == 0 else 0.038) + (0.012 if tier >= 3 else 0.0)
		_blade(m, a, b + along * 0.03, b + outward * reach, 0.03, mane)


	var eye: = GEM if tier >= 3 else (GEM_DIM if tier >= 2 else CARVED)
	for side in [-1.0, 1.0]:
		_decal(m, Vector3(0.11 * side, 0.862, -0.08), Vector3(side, 0.15, -0.12), 0.024, 0.013, eye)
		_decal(m, Vector3(0.046 * side, 0.705, -0.321), Vector3(side * 0.6, 0.0, -1.0), 0.01, 0.015, CARVED)
		_decal(m, Vector3(0.076 * side, 0.69, -0.285), Vector3(side, -0.2, -0.1), 0.032, 0.004, CARVED)


	if tier >= 1:
		_band(m, -0.245, -0.215, 1.07, TRIM if tier == 1 else CLOTH)
	if tier >= 2:
		_band(m, -0.035, -0.012, 1.05, TRIM)
		for side in [-1.0, 1.0]:
			_gem(m, Vector3(0.097 * side, 0.785, -0.17), Vector3(side, 0.0, 0.0), 0.016, TRIM)
	if tier >= 3:
		_gem(m, Vector3(0.0, 0.888, -0.12), Vector3(0.0, 1.0, -0.5), 0.03, GEM)
		_studs(m, r, TRIM)



static func _ring_xz(y: float, zc: float, half_w: float, half_d: float) -> PackedVector3Array:
	var out: = PackedVector3Array()
	for i in _LOFT_POINTS:
		var t: = TAU * i / _LOFT_POINTS
		out.append(Vector3(half_w * _super(cos(t)), y, zc + half_d * _super(sin(t))))
	return out



static func _ring_xy(z: float, yc: float, half_w: float, above: float, below: float) -> PackedVector3Array:
	var out: = PackedVector3Array()
	for i in _LOFT_POINTS:
		var t: = TAU * i / _LOFT_POINTS
		var s: = _super(sin(t))
		out.append(Vector3(half_w * _super(cos(t)), yc + s * (above if s > 0.0 else below), z))
	return out


static func _super(v: float) -> float:
	return signf(v) * pow(absf(v), 2.0 / _LOFT_POWER)



static func _band(m: _Mesh, z0: float, z1: float, grow: float, color: Color) -> void :
	var rings: Array = []
	for z in [z0, z1]:
		var s: = _head_at(z)
		rings.append(_ring_xy(z, s[0], s[1] * grow, s[2] * grow, s[3] * grow))
	_loft(m, rings, color, false)



static func _head_at(z: float) -> Array:
	for i in _HEAD.size() - 1:
		var a: Array = _HEAD[i]
		var b: Array = _HEAD[i + 1]
		if z <= a[0] and z >= b[0]:
			var t: float = (a[0] - z) / (a[0] - b[0])
			return [lerpf(a[1], b[1], t), lerpf(a[2], b[2], t), lerpf(a[3], b[3], t), lerpf(a[4], b[4], t)]
	assert (false, "z %.3f is outside the knight's head" % z)
	return []





static func _facet_distance(r: float, sides: int) -> float:
	return r * cos(PI / sides)






static func _lathe(m: _Mesh, prof: _Profile, sides: int, xform: = Transform3D.IDENTITY, paint: = {}) -> void :
	var stations: = _stations(sides)
	var pts: = prof.points
	var normal_xform: = xform.basis.inverse().transposed()
	var seg_normals: Array[Vector2] = []
	for i in pts.size() - 1:
		var d: = pts[i + 1] - pts[i]
		seg_normals.append(Vector2(d.y, - d.x).normalized())
	for i in pts.size() - 1:
		var p0: = pts[i]
		var p1: = pts[i + 1]
		if p0.x < 1e-05 and p1.x < 1e-05:
			continue
		var n0: = _joint_normal(prof, seg_normals, i, true)
		var n1: = _joint_normal(prof, seg_normals, i + 1, false)
		var a0: = _joint_cavity(prof, i)
		var a1: = _joint_cavity(prof, i + 1)
		var color: Color = prof.colors[i]
		var y_mid: = (p0.y + p1.y) * 0.5
		for j in stations.size():
			var s0: Array = stations[j]
			var s1: Array = stations[(j + 1) % stations.size()]
			var c: = _station_color(paint, s0, stations, j, y_mid, color)
			var q0: Vector2 = s0[0]
			var q1: Vector2 = s1[0]
			var h0: Vector2 = s0[1]
			var h1: Vector2 = s1[1]
			var v: = [Vector3(q0.x * p0.x, p0.y, q0.y * p0.x), Vector3(q1.x * p0.x, p0.y, q1.y * p0.x), 
				Vector3(q1.x * p1.x, p1.y, q1.y * p1.x), Vector3(q0.x * p1.x, p1.y, q0.y * p1.x)]
			var n: = [Vector3(h0.x * n0.x, n0.y, h0.y * n0.x), Vector3(h1.x * n0.x, n0.y, h1.y * n0.x), 
				Vector3(h1.x * n1.x, n1.y, h1.y * n1.x), Vector3(h0.x * n1.x, n1.y, h0.y * n1.x)]
			var colors: = [Color(c, a0), Color(c, a0), Color(c, a1), Color(c, a1)]
			for k in 4:
				v[k] = xform * v[k]
				n[k] = (normal_xform * n[k]).normalized()
			m.quad(v, n, colors)




static func _stations(sides: int) -> Array:
	var out: = []
	if sides == 0:
		for k in ROUND:
			var d: = _dir(TAU * k / ROUND)
			out.append([d, d, -1, false])
		return out
	for i in sides:
		var c0: = _dir(TAU * (i - 0.5) / sides)
		var c1: = _dir(TAU * (i + 0.5) / sides)
		var facet: = _dir(TAU * i / sides)
		out.append([c0.lerp(c1, BEVEL), facet, i, false])
		out.append([c1.lerp(c0, BEVEL), facet, i, true])
	return out


static func _dir(angle: float) -> Vector2:
	return Vector2(sin(angle), - cos(angle))


static func _station_color(paint: Dictionary, station: Array, stations: Array, j: int, y: float, base: Color) -> Color:
	if paint.is_empty() or station[2] < 0:
		return base
	var chamfer: bool = station[3]
	if paint.has("ribs"):
		var span: Array = paint.ribs
		return paint.color if chamfer and y >= span[0] and y <= span[1] else base
	if y < paint.y0 or y > paint.y1:
		return base
	var facets: Array = paint.facets
	if not chamfer:
		return paint.color if facets.has(station[2]) else base
	var next: Array = stations[(j + 1) % stations.size()]
	return paint.edge if facets.has(station[2]) or facets.has(next[2]) else base



static func _joint_normal(prof: _Profile, seg_normals: Array[Vector2], joint: int, leaving: bool) -> Vector2:
	var own: Vector2 = seg_normals[joint] if leaving else seg_normals[joint - 1]
	if joint <= 0 or joint >= prof.points.size() - 1 or not prof.smooth[joint]:
		return own
	return (seg_normals[joint - 1] + seg_normals[joint]).normalized()



static func _joint_cavity(prof: _Profile, joint: int) -> float:
	if joint <= 0 or joint >= prof.points.size() - 1 or prof.smooth[joint]:
		return 1.0
	var before: = prof.points[joint] - prof.points[joint - 1]
	var after: = prof.points[joint + 1] - prof.points[joint]
	return CREVICE if before.cross(after) < -1e-06 else 1.0


static func _ball(m: _Mesh, centre: Vector3, radius: float, color: Color) -> void :
	var p: = _Profile.new(Vector2(0.0, - radius))
	p.paint(color)
	p.arc(Vector2.ZERO, radius, -90.0, 90.0)
	_lathe(m, p, 0, Transform3D(Basis(), centre))



static func _block(m: _Mesh, centre: Vector3, half: Vector3, color: Color, basis: = Basis()) -> void :
	var b: = 0.14
	var p: = _Profile.new(Vector2(0.0, -1.0))
	p.paint(color)
	p.to(Vector2(sqrt(2.0) * (1.0 - b), -1.0))
	p.to(Vector2(sqrt(2.0), -1.0 + b))
	p.to(Vector2(sqrt(2.0), 1.0 - b))
	p.to(Vector2(sqrt(2.0) * (1.0 - b), 1.0))
	p.to(Vector2(0.0, 1.0))
	_lathe(m, p, 4, Transform3D(basis * Basis.from_scale(half), centre))




static func _loft(m: _Mesh, rings: Array, color: Color, caps: = true, faceted: = false) -> void :
	var rows: = rings.size()
	var cols: int = rings[0].size()
	var centres: Array[Vector3] = []
	for ring: PackedVector3Array in rings:
		var sum: = Vector3.ZERO
		for q in ring:
			sum += q
		centres.append(sum / cols)
	var normals: Array[PackedVector3Array] = []
	for r in rows:
		var row: = PackedVector3Array()
		for c in cols:
			var here: Vector3 = rings[r][c]
			var around: Vector3 = rings[r][(c + 1) % cols] - rings[r][(c - 1 + cols) % cols]
			var along: Vector3 = rings[mini(r + 1, rows - 1)][c] - rings[maxi(r - 1, 0)][c]
			var n: = around.cross(along).normalized()
			if n.dot(here - centres[r]) < 0.0:
				n = - n
			row.append(n)
		normals.append(row)
	for r in rows - 1:
		for c in cols:
			var d: = (c + 1) % cols
			var corners: = [rings[r][c], rings[r][d], rings[r + 1][d], rings[r + 1][c]]
			var shading: = [normals[r][c], normals[r][d], normals[r + 1][d], normals[r + 1][c]]
			if faceted:
				var flat: Vector3 = (shading[0] + shading[1] + shading[2] + shading[3]).normalized()
				shading = [flat, flat, flat, flat]
			m.quad(corners, shading, [color, color, color, color])
	if not caps:
		return
	for end in [0, rows - 1]:
		var ring: PackedVector3Array = rings[end]
		var axis: = (centres[end] - centres[1 if end == 0 else rows - 2]).normalized()
		for c in cols:
			m.tri(centres[end], ring[c], ring[(c + 1) % cols], axis, axis, axis, color, color, color)



static func _pyramid(m: _Mesh, base: Array, apex: Vector3, color: Color) -> void :
	var centre: Vector3 = (base[0] + base[1] + base[2] + base[3]) * 0.25
	for i in 4:
		var a: Vector3 = base[i]
		var b: Vector3 = base[(i + 1) % 4]
		var n: = (b - a).cross(apex - a).normalized()
		if n.dot((a + b) * 0.5 - centre) < 0.0:
			n = - n
		m.tri(a, b, apex, n, n, n, color, color, color)
	var down: = (centre - apex).normalized()
	m.tri(base[0], base[1], base[2], down, down, down, color, color, color)
	m.tri(base[0], base[2], base[3], down, down, down, color, color, color)



static func _blade(m: _Mesh, a: Vector3, b: Vector3, tip: Vector3, half: float, color: Color) -> void :
	var x: = Vector3(half, 0.0, 0.0)
	var t: = Vector3(half * 0.35, 0.0, 0.0)
	for side in [-1.0, 1.0]:
		var n: = Vector3(side, 0.0, 0.0)
		m.tri(a + x * side, b + x * side, tip + t * side, n, n, n, color, color, color)
	for edge in [[a, tip], [tip, b]]:
		var e0: Vector3 = edge[0]
		var e1: Vector3 = edge[1]
		var n: = (e1 - e0).cross(Vector3.RIGHT).normalized()
		var middle: = (a + b + tip) / 3.0
		if n.dot((e0 + e1) * 0.5 - middle) < 0.0:
			n = - n
		var w0: = x if e0 != tip else t
		var w1: = x if e1 != tip else t
		m.quad([e0 + w0, e1 + w1, e1 - w1, e0 - w0], [n, n, n, n], [color, color, color, color])



static func _gem(m: _Mesh, centre: Vector3, normal: Vector3, size: float, color: Color) -> void :
	var out: = normal.normalized()
	var up: = (Vector3.UP - out * out.dot(Vector3.UP)).normalized() if absf(out.dot(Vector3.UP)) < 0.95 else Vector3.FORWARD
	var right: = up.cross(out).normalized()
	var base: = [centre + up * size * 1.3, centre + right * size * 0.8, centre - up * size * 1.3, centre - right * size * 0.8]
	_pyramid(m, base, centre + out * size * 0.7, color)



static func _decal(m: _Mesh, centre: Vector3, normal: Vector3, half_w: float, half_h: float, color: Color) -> void :
	var out: = normal.normalized()
	var up: = (Vector3.UP - out * out.dot(Vector3.UP)).normalized()
	var right: = up.cross(out).normalized()
	m.quad([centre + up * half_h, centre + right * half_w, centre - up * half_h, centre - right * half_w], 
		[out, out, out, out], [color, color, color, color])






class _Profile:
	var points: Array[Vector2] = []
	var colors: Array[Color] = []
	var smooth: Array[bool] = []
	var pen: = Color(0.0, 0.0, 0.0, 1.0)

	func _init(start: Vector2) -> void :
		points.append(start)
		smooth.append(false)

	func paint(color: Color) -> void :
		pen = color

	func to(p: Vector2) -> void :
		colors.append(pen)
		points.append(p)
		smooth.append(false)

	func curve(c1: Vector2, c2: Vector2, end: Vector2, steps: = 10) -> void :
		var start: = points[points.size() - 1]
		for k in range(1, steps + 1):
			var t: = float(k) / steps
			var u: = 1.0 - t
			to(start * u * u * u + c1 * 3.0 * u * u * t + c2 * 3.0 * u * t * t + end * t * t * t)
			smooth[smooth.size() - 1] = k < steps

	func arc(centre: Vector2, radius: float, from_deg: float, to_deg: float, steps: = 12) -> void :
		for k in range(1, steps + 1):
			var a: = deg_to_rad(lerpf(from_deg, to_deg, float(k) / steps))
			to(centre + Vector2(cos(a), sin(a)) * radius)
			smooth[smooth.size() - 1] = k < steps



class _Mesh:
	var verts: = PackedVector3Array()
	var normals: = PackedVector3Array()
	var colors: = PackedColorArray()


	func tri(a: Vector3, b: Vector3, c: Vector3, na: Vector3, nb: Vector3, nc: Vector3, ca: Color, cb: Color, cc: Color) -> void :
		var face: = (b - a).cross(c - a)
		if face.length_squared() < 1e-14:
			return
		if face.dot(na + nb + nc) > 0.0:
			_add(a, na, ca)
			_add(c, nc, cc)
			_add(b, nb, cb)
		else:
			_add(a, na, ca)
			_add(b, nb, cb)
			_add(c, nc, cc)

	func _add(v: Vector3, n: Vector3, c: Color) -> void :
		verts.append(v)
		normals.append(n)
		colors.append(c)


	func quad(v: Array, n: Array, c: Array) -> void :
		tri(v[0], v[1], v[2], n[0], n[1], n[2], c[0], c[1], c[2])
		tri(v[0], v[2], v[3], n[0], n[2], n[3], c[0], c[2], c[3])

	func commit(height: float) -> ArrayMesh:
		var uvs: = PackedVector2Array()
		uvs.resize(verts.size())
		for i in verts.size():
			var v: = verts[i]
			uvs[i] = Vector2(fposmod(atan2(v.x, - v.z) / TAU, 1.0), clampf(v.y / height, 0.0, 1.0))
		var arrays: = []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX] = verts
		arrays[Mesh.ARRAY_NORMAL] = normals
		arrays[Mesh.ARRAY_TEX_UV] = uvs
		arrays[Mesh.ARRAY_COLOR] = colors
		var mesh: = ArrayMesh.new()
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		return mesh
