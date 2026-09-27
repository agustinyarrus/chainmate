extends RefCounted
## Oracle probe #3 — procedural geometry straight out of the original generators.
## Piece meshes (6 kinds × 4 tiers), MeshKit shapes and the arena's stone kit, dumped as base64 of the
## vertex arrays exactly as Godot stores them (positions float32, colours as the 8-bit values).

func _emit(entry: Dictionary) -> void:
	print("ORACLE ", JSON.stringify(entry, "", false, true))


func _b64(data: PackedByteArray) -> String:
	return Marshalls.raw_to_base64(data)


func _dump(label: String, mesh: ArrayMesh) -> void:
	var arrays: = mesh.surface_get_arrays(0)
	var entry: = {"k": "mesh", "label": label}
	var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	entry.count = verts.size()
	entry.positions = _b64(verts.to_byte_array())
	if arrays[Mesh.ARRAY_NORMAL] != null:
		entry.normals = _b64((arrays[Mesh.ARRAY_NORMAL] as PackedVector3Array).to_byte_array())
	if arrays[Mesh.ARRAY_TEX_UV] != null:
		entry.uvs = _b64((arrays[Mesh.ARRAY_TEX_UV] as PackedVector2Array).to_byte_array())
	if arrays[Mesh.ARRAY_TEX_UV2] != null:
		entry.uv2s = _b64((arrays[Mesh.ARRAY_TEX_UV2] as PackedVector2Array).to_byte_array())
	if arrays[Mesh.ARRAY_COLOR] != null:
		entry.colors = _b64((arrays[Mesh.ARRAY_COLOR] as PackedColorArray).to_byte_array())
	if arrays[Mesh.ARRAY_INDEX] != null:
		entry.indices = _b64((arrays[Mesh.ARRAY_INDEX] as PackedInt32Array).to_byte_array())
	_emit(entry)


func run(_host: Node) -> void:
	for kind in PieceMeshes.KINDS:
		for tier in PieceMeshes.MAX_TIER + 1:
			_dump("piece:%s:%d" % [kind, tier], PieceMeshes.get_mesh(kind, tier))
	_dump("kit:beveled_box", MeshKit.beveled_box(Vector3(0.9, 0.2, 0.7), 0.05))
	_dump("kit:frame_ring", MeshKit.frame_ring(0.4, 0.5, 0.02))
	var points: = PackedVector3Array()
	for s in 19:
		var t: = float(s) / 18
		var point: = Vector3(-1.5, 0.09, 1.0).lerp(Vector3(0.5, 0.09, -1.0), t)
		point.y += sin(PI * t) * 0.7
		points.append(point)
	_dump("kit:ribbon", MeshKit.ribbon(points, 0.12))
	_dump("arena:tile", Arena.tile_mesh())
	for index in 3:
		_dump("arena:brick%d" % index, Arena._block_mesh(Vector3(2.0, 1.0, 1.0), 0.1, 0.035, 2 + index % 2, 100 + index * 17 + 1000, Vector3i(5, 2, 2)))
	for index in 6:
		_dump("arena:cube%d" % index, Arena._block_mesh(Vector3.ONE, 0.1, 0.035, 1 + index % 3, 100 + index * 17, Vector3i(2, 2, 2)))
