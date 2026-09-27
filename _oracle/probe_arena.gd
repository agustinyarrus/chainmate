extends RefCounted
## Oracle probe #4 — the three arena layouts as built by the original Arena node: every stone
## instance (kit mesh, transform, tint), every leaf, the flickering lights, the prop roots, the
## stone tops used to seat props and the relic spots.

func _emit(entry: Dictionary) -> void:
	print("ORACLE ", JSON.stringify(entry, "", false, true))


func _xf(t: Transform3D) -> Array:
	var b: = t.basis
	return [b.x.x, b.x.y, b.x.z, b.y.x, b.y.y, b.y.z, b.z.x, b.z.y, b.z.z, t.origin.x, t.origin.y, t.origin.z]


func _kit_key(mesh: Mesh) -> String:
	for key in Arena._kit:
		if Arena._kit[key] == mesh:
			return key
	return "?"


func run(host: Node) -> void:
	var arena: = Arena.new()
	host.add_child(arena)
	for variant in Arena.VARIANTS:
		arena.set_variant(variant)
		var content: Node3D = arena._content
		var instances: = []
		var props: = []
		for child in content.get_children():
			if child is MultiMeshInstance3D:
				var mm: MultiMesh = (child as MultiMeshInstance3D).multimesh
				var material: = (child as MultiMeshInstance3D).material_override
				var label: = _kit_key(mm.mesh)
				if material is ShaderMaterial and (material as ShaderMaterial).shader.resource_path.ends_with("foliage.gdshader"):
					label = "leaf:%d" % int((material as ShaderMaterial).get_shader_parameter("shape"))
				var xfs: = []
				var tints: = []
				for i in mm.instance_count:
					xfs.append(_xf(mm.get_instance_transform(i)))
					var c: = mm.get_instance_color(i)
					tints.append([c.r, c.g, c.b, c.a])
				instances.append({"label": label, "count": mm.instance_count, "xf": xfs, "tint": tints})
			elif child is Node3D:
				var node: = child as Node3D
				props.append({"name": String(node.name), "class": node.get_class(), "pos": [node.global_position.x, node.global_position.y, node.global_position.z], "rot": [node.rotation.x, node.rotation.y, node.rotation.z]})
		var flames: = []
		for flame in arena._flames:
			var light: OmniLight3D = flame.light
			flames.append({"pos": [light.global_position.x, light.global_position.y, light.global_position.z], "energy": flame.energy,
				"speed": flame.speed, "phase": flame.phase, "flicker": flame.flicker, "range": light.omni_range, "att": light.omni_attenuation})
		var tops: = []
		for top in arena._tops:
			var rect: Rect2 = top[0]
			tops.append([rect.position.x, rect.position.y, rect.size.x, rect.size.y, top[1]])
		var spots: = []
		for i in 6:
			var spot: = arena.relic_spot(i)
			spots.append([spot.x, spot.y, spot.z])
		_emit({"k": "arena", "variant": variant, "instances": instances, "props": props, "flames": flames, "tops": tops, "relic_spots": spots,
			"rng_state": str(arena._rng.state)})
