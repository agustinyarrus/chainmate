class_name MeshKit
extends RefCounted





static func beveled_box(size: Vector3, bevel: float) -> ArrayMesh:
	var st: = SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var hx: = size.x * 0.5
	var hy: = size.y * 0.5
	var hz: = size.z * 0.5
	var shoulder: = hy - bevel
	var ix: = hx - bevel
	var iz: = hz - bevel
	var top: = [Vector3( - ix, hy, - iz), Vector3(ix, hy, - iz), Vector3(ix, hy, iz), Vector3( - ix, hy, iz)]
	var mid: = [Vector3( - hx, shoulder, - hz), Vector3(hx, shoulder, - hz), Vector3(hx, shoulder, hz), Vector3( - hx, shoulder, hz)]
	var low: = [Vector3( - hx, - hy, - hz), Vector3(hx, - hy, - hz), Vector3(hx, - hy, hz), Vector3( - hx, - hy, hz)]
	_quad(st, top[0], top[1], top[2], top[3], Vector3.UP)
	_quad(st, low[3], low[2], low[1], low[0], Vector3.DOWN)
	var outward: = [Vector3.FORWARD, Vector3.RIGHT, Vector3.BACK, Vector3.LEFT]
	for i in 4:
		var j: = (i + 1) % 4
		var side: Vector3 = outward[i]
		_quad(st, mid[i], mid[j], low[j], low[i], side)
		var slope: = (side + Vector3.UP).normalized()
		_quad(st, top[i], top[j], mid[j], mid[i], slope)
	return st.commit()



static func frame_ring(inner_half: float, outer_half: float, height: float) -> ArrayMesh:
	var st: = SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var inner: = [Vector3( - inner_half, height, - inner_half), Vector3(inner_half, height, - inner_half), Vector3(inner_half, height, inner_half), Vector3( - inner_half, height, inner_half)]
	var outer: = [Vector3( - outer_half, height, - outer_half), Vector3(outer_half, height, - outer_half), Vector3(outer_half, height, outer_half), Vector3( - outer_half, height, outer_half)]
	for i in 4:
		var j: = (i + 1) % 4
		_quad(st, outer[i], outer[j], inner[j], inner[i], Vector3.UP)
	return st.commit()



static func ribbon(points: PackedVector3Array, width: float) -> ArrayMesh:
	var mesh: = ArrayMesh.new()
	if points.size() < 2:
		return mesh
	var st: = SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var travelled: = 0.0
	var lefts: PackedVector3Array = []
	var rights: PackedVector3Array = []
	var distances: PackedFloat32Array = []
	for i in points.size():
		var ahead: = points[mini(i + 1, points.size() - 1)] - points[maxi(i - 1, 0)]
		ahead.y = 0.0
		if ahead.length_squared() < 1e-06:
			ahead = Vector3.FORWARD
		var side: = ahead.normalized().cross(Vector3.UP) * width * 0.5
		lefts.append(points[i] - side)
		rights.append(points[i] + side)
		if i > 0:
			travelled += points[i].distance_to(points[i - 1])
		distances.append(travelled)
	for i in points.size() - 1:
		var u0: = distances[i]
		var u1: = distances[i + 1]
		_uv_tri(st, lefts[i], Vector2(u0, 0), rights[i], Vector2(u0, 1), rights[i + 1], Vector2(u1, 1))
		_uv_tri(st, lefts[i], Vector2(u0, 0), rights[i + 1], Vector2(u1, 1), lefts[i + 1], Vector2(u1, 0))
	return st.commit()


static func _quad(st: SurfaceTool, a: Vector3, b: Vector3, c: Vector3, d: Vector3, normal: Vector3) -> void :
	_tri(st, a, b, c, normal)
	_tri(st, a, c, d, normal)


static func _tri(st: SurfaceTool, a: Vector3, b: Vector3, c: Vector3, normal: Vector3) -> void :
	if (b - a).cross(c - a).dot(normal) > 0.0:
		var swap: = b
		b = c
		c = swap
	for vertex in [a, b, c]:
		st.set_normal(normal)
		st.set_uv(Vector2(vertex.x, vertex.z))
		st.add_vertex(vertex)


static func _uv_tri(st: SurfaceTool, a: Vector3, ua: Vector2, b: Vector3, ub: Vector2, c: Vector3, uc: Vector2) -> void :
	var vertices: = [a, b, c]
	var uvs: = [ua, ub, uc]
	if (b - a).cross(c - a).dot(Vector3.UP) > 0.0:
		vertices = [a, c, b]
		uvs = [ua, uc, ub]
	for i in 3:
		st.set_normal(Vector3.UP)
		st.set_uv(uvs[i])
		st.add_vertex(vertices[i])
