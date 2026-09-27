extends RefCounted
## Oracle probe — relic miniatures and daises as the original builds them: every MeshInstance3D with its
## transform relative to the model root, its mesh (primitive parameters, or vertex count and bounds for
## ArrayMeshes) and its material values. The port's RelicModels must produce the same list.


func _emit(entry: Dictionary) -> void:
	print("ORACLE ", JSON.stringify(entry, "", false, true))


func run(host: Node) -> void:
	for id in Relics.CATALOGUE:
		_dump("relic", id, RelicModels.build(id), host)
	for rarity in ["common", "uncommon", "rare"]:
		_dump("dais", rarity, RelicModels.dais(rarity), host)


func _dump(kind: String, id: String, root: Node3D, host: Node) -> void:
	host.add_child(root)
	var parts := []
	var inverse := root.global_transform.affine_inverse()
	_walk(root, inverse, parts)
	_emit({"k": kind, "id": id, "parts": parts})
	root.queue_free()


func _walk(node: Node, inverse: Transform3D, parts: Array) -> void:
	for child in node.get_children():
		if child is MeshInstance3D:
			var t: Transform3D = inverse * (child as MeshInstance3D).global_transform
			parts.append({
				"t": [t.basis.x.x, t.basis.x.y, t.basis.x.z, t.basis.y.x, t.basis.y.y, t.basis.y.z, t.basis.z.x, t.basis.z.y, t.basis.z.z, t.origin.x, t.origin.y, t.origin.z],
				"mesh": _mesh(child.mesh),
				"material": _material(child.material_override),
			})
		_walk(child, inverse, parts)


func _mesh(mesh: Mesh) -> Dictionary:
	if mesh is BoxMesh:
		return {"type": "box", "size": [mesh.size.x, mesh.size.y, mesh.size.z]}
	if mesh is CylinderMesh:
		return {"type": "cylinder", "top": mesh.top_radius, "bottom": mesh.bottom_radius, "height": mesh.height, "segments": mesh.radial_segments, "rings": mesh.rings, "caps": [mesh.cap_top, mesh.cap_bottom]}
	if mesh is SphereMesh:
		return {"type": "sphere", "radius": mesh.radius, "height": mesh.height, "segments": mesh.radial_segments, "rings": mesh.rings}
	if mesh is TorusMesh:
		return {"type": "torus", "inner": mesh.inner_radius, "outer": mesh.outer_radius, "rings": mesh.rings, "ring_segments": mesh.ring_segments}
	if mesh is QuadMesh:
		return {"type": "quad", "size": [mesh.size.x, mesh.size.y]}
	var arrays := mesh.surface_get_arrays(0)
	var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var aabb := mesh.get_aabb()
	return {"type": "array", "vertices": vertices.size(), "aabb": [aabb.position.x, aabb.position.y, aabb.position.z, aabb.size.x, aabb.size.y, aabb.size.z]}


func _material(material: Material) -> Dictionary:
	if material is StandardMaterial3D:
		var m := material as StandardMaterial3D
		return {"type": "standard", "albedo": m.albedo_color.to_html(), "roughness": m.roughness, "metallic": m.metallic,
			"specular": m.metallic_specular, "transparency": m.transparency, "cull": m.cull_mode,
			"emission": m.emission.to_html() if m.emission_enabled else "", "unshaded": m.shading_mode == BaseMaterial3D.SHADING_MODE_UNSHADED}
	if material is ShaderMaterial:
		return {"type": "shader", "shader": (material as ShaderMaterial).shader.resource_path.get_file()}
	return {"type": "none"}
