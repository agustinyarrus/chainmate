extends RefCounted
## Oracle probe — render stages.
##
## Plays the opening of the autopilot's arena tour and, at each camera stop, FREEZES time and saves
## for that one frame:
##
##   · the engine's own debug views  (normal buffer, SSAO, SSIL, shadow atlas, PSSM splits, unshaded…)
##   · an ablation matrix            (each light and each environment feature alone, over a bare
##                                    linear image), so a difference can be blamed on one term
##
## together with the state that rebuilds the frame: camera, shader TIME, every light, the
## environment and every geometry instance. The port renders the same stages from the same state
## (e2e/stages.mjs) and each pair of images is compared on its own.
##
##   node tools/oracle.mjs stages --windowed --fixed-fps 60 --timeout 1200
##
## Run it with --fixed-fps: every frame then advances exactly 1/60 s, like the port's fixed step.

const SETTLE_FRAMES := 16
const SEED := "TOUR-7"
const LOW_PITCH := 0.68
const LOW_YAW_OFFSET := -0.7

## Debug views of the full frame: name → Viewport.DebugDraw.
const VIEWS := {
	"final": Viewport.DEBUG_DRAW_DISABLED,
	"unshaded": Viewport.DEBUG_DRAW_UNSHADED,
	"lighting": Viewport.DEBUG_DRAW_LIGHTING,
	"normal": Viewport.DEBUG_DRAW_NORMAL_BUFFER,
	"ssao": Viewport.DEBUG_DRAW_SSAO,
	"ssil": Viewport.DEBUG_DRAW_SSIL,
	"shadow_atlas": Viewport.DEBUG_DRAW_DIRECTIONAL_SHADOW_ATLAS,
	"pssm": Viewport.DEBUG_DRAW_PSSM_SPLITS,
	"internal": Viewport.DEBUG_DRAW_INTERNAL_BUFFER,
}
const LOW_VIEWS: PackedStringArray = ["final", "normal", "ssao", "ssil", "pssm"]

## The bare image: lights, ambient and reflections through a linear tone curve, nothing else.
const BARE := {
	"glow_enabled": false,
	"ssao_enabled": false,
	"ssil_enabled": false,
	"fog_enabled": false,
	"volumetric_fog_enabled": false,
	"adjustment_enabled": false,
	"tonemap_mode": Environment.TONE_MAPPER_LINEAR,
	"tonemap_exposure": 1.0,
	"tonemap_white": 1.0,
}
const NO_AMBIENT := {"ambient_light_energy": 0.0}
const NO_REFLECTION := {"reflected_light_source": Environment.REFLECTION_SOURCE_DISABLED}

## Ablation matrix: name → {keep: environment properties that stay as the game set them,
## set: overrides on top of BARE, lights: which lights stay visible, shadow: key light shadow}.
const ABLATIONS := [
	{"name": "bare", "keep": [], "set": {}, "lights": "all", "shadow": false},
	{"name": "bare_shadow", "keep": [], "set": {}, "lights": "all", "shadow": true},
	{"name": "bare_ssao", "keep": ["ssao_enabled"], "set": {}, "lights": "all", "shadow": false},
	{"name": "bare_ssil", "keep": ["ssil_enabled"], "set": {}, "lights": "all", "shadow": false},
	{"name": "bare_fog", "keep": ["fog_enabled"], "set": {}, "lights": "all", "shadow": false},
	{"name": "bare_volfog", "keep": ["volumetric_fog_enabled"], "set": {}, "lights": "all", "shadow": false, "needs": "volumetric_fog_enabled"},
	{"name": "bare_glow", "keep": ["glow_enabled"], "set": {}, "lights": "all", "shadow": false},
	{"name": "bare_grade", "keep": ["adjustment_enabled", "tonemap_mode", "tonemap_exposure", "tonemap_white"], "set": {}, "lights": "all", "shadow": false},
	{"name": "ambient", "keep": [], "set": NO_REFLECTION, "lights": "none", "shadow": false},
	{"name": "reflection", "keep": [], "set": {}, "lights": "none", "shadow": false},
	{"name": "key", "keep": [], "set": [NO_AMBIENT, NO_REFLECTION], "lights": "key", "shadow": false},
	{"name": "key_shadow", "keep": [], "set": [NO_AMBIENT, NO_REFLECTION], "lights": "key", "shadow": true},
	{"name": "fill", "keep": [], "set": [NO_AMBIENT, NO_REFLECTION], "lights": "fill", "shadow": false},
	{"name": "omni", "keep": [], "set": [NO_AMBIENT, NO_REFLECTION], "lights": "omni", "shadow": false},
]
const LOW_ABLATIONS: PackedStringArray = ["bare", "bare_shadow"]

const ENVIRONMENT_PROPERTIES: PackedStringArray = [
	"background_mode", "background_energy_multiplier", "ambient_light_source", "ambient_light_color", "ambient_light_energy",
	"ambient_light_sky_contribution", "reflected_light_source",
	"tonemap_mode", "tonemap_exposure", "tonemap_white",
	"glow_enabled", "glow_intensity", "glow_strength", "glow_mix", "glow_bloom", "glow_blend_mode", "glow_hdr_threshold",
	"glow_hdr_scale", "glow_hdr_luminance_cap", "glow_levels/1", "glow_levels/2", "glow_levels/3", "glow_levels/4",
	"glow_levels/5", "glow_levels/6", "glow_levels/7",
	"ssao_enabled", "ssao_radius", "ssao_intensity", "ssao_power", "ssao_detail", "ssao_horizon", "ssao_sharpness",
	"ssao_light_affect", "ssao_ao_channel_affect",
	"ssil_enabled", "ssil_radius", "ssil_intensity", "ssil_sharpness", "ssil_normal_rejection",
	"fog_enabled", "fog_mode", "fog_light_color", "fog_light_energy", "fog_sun_scatter", "fog_density", "fog_height",
	"fog_height_density", "fog_aerial_perspective", "fog_sky_affect",
	"volumetric_fog_enabled", "volumetric_fog_density", "volumetric_fog_albedo", "volumetric_fog_emission",
	"volumetric_fog_emission_energy", "volumetric_fog_gi_inject", "volumetric_fog_anisotropy", "volumetric_fog_length",
	"volumetric_fog_detail_spread", "volumetric_fog_ambient_inject", "volumetric_fog_sky_affect",
	"volumetric_fog_temporal_reprojection_enabled", "volumetric_fog_temporal_reprojection_amount",
	"adjustment_enabled", "adjustment_brightness", "adjustment_contrast", "adjustment_saturation",
]

const LIGHT_PARAMS := {
	"energy": Light3D.PARAM_ENERGY, "indirect_energy": Light3D.PARAM_INDIRECT_ENERGY,
	"volumetric_fog_energy": Light3D.PARAM_VOLUMETRIC_FOG_ENERGY, "specular": Light3D.PARAM_SPECULAR,
	"range": Light3D.PARAM_RANGE, "size": Light3D.PARAM_SIZE, "attenuation": Light3D.PARAM_ATTENUATION,
	"shadow_max_distance": Light3D.PARAM_SHADOW_MAX_DISTANCE, "split_1": Light3D.PARAM_SHADOW_SPLIT_1_OFFSET,
	"split_2": Light3D.PARAM_SHADOW_SPLIT_2_OFFSET, "split_3": Light3D.PARAM_SHADOW_SPLIT_3_OFFSET,
	"shadow_fade_start": Light3D.PARAM_SHADOW_FADE_START, "shadow_normal_bias": Light3D.PARAM_SHADOW_NORMAL_BIAS,
	"shadow_bias": Light3D.PARAM_SHADOW_BIAS, "shadow_pancake_size": Light3D.PARAM_SHADOW_PANCAKE_SIZE,
	"shadow_opacity": Light3D.PARAM_SHADOW_OPACITY, "shadow_blur": Light3D.PARAM_SHADOW_BLUR,
	"transmittance_bias": Light3D.PARAM_TRANSMITTANCE_BIAS, "intensity": Light3D.PARAM_INTENSITY,
}

var _host: Node
var _tree: SceneTree
var _viewport: Viewport
var _main: Node
var _clock: Node
var _out := ""
var _images := 0


func _emit(entry: Dictionary) -> void:
	print("ORACLE ", JSON.stringify(entry, "", false, true))


func run(host: Node) -> void:
	_host = host
	_tree = host.get_tree()
	_viewport = host.get_viewport()
	_out = (get_script() as Script).resource_path.get_base_dir().get_base_dir().path_join("_ref/stages")
	DirAccess.make_dir_recursive_absolute(_out)
	host._register_input()
	_clock = _make_clock()
	host.add_child(_clock)
	while _tree.current_scene == null:
		await _tree.process_frame
	_main = _tree.current_scene
	_emit({"k": "setup", "engine": Engine.get_version_info().string, "renderer": RenderingServer.get_current_rendering_method(),
		"adapter": RenderingServer.get_video_adapter_name(), "viewport": _v2(_viewport.get_visible_rect().size),
		"window": [DisplayServer.window_get_size().x, DisplayServer.window_get_size().y],
		"msaa_3d": _viewport.msaa_3d, "scaling_3d_scale": _viewport.scaling_3d_scale, "use_taa": _viewport.use_taa,
		"use_debanding": _viewport.use_debanding, "screen_space_aa": _viewport.screen_space_aa,
		"physics_ticks": Engine.physics_ticks_per_second, "max_fps": Engine.max_fps, "out": _out.get_file(),
		"project": _project_settings()})

	# The opening of autopilot.gd's arena tour, call for call.
	await _wait(0.5)
	_main.start_run({"seed": SEED, "army": "vanguard", "difficulty": "standard"})
	await _wait(0.8)
	_main.gs.skip_relic()
	_main._leave_stop()
	await _wait(0.6)
	_main._choose_node(0)
	await _wait(2.5)
	_main.hud.visible = false
	for variant in Arena.VARIANTS:
		_main.arena.set_variant(variant)
		_main.rig.reset_view()
		await _wait(1.8)
		await _stages(variant, VIEWS.keys(), _names(ABLATIONS))
		_main.rig.target_pitch = LOW_PITCH
		_main.rig.target_yaw = CameraRig.DEFAULT_YAW + LOW_YAW_OFFSET
		await _wait(1.8)
		await _stages(variant + "_low", LOW_VIEWS, LOW_ABLATIONS)
	_emit({"k": "done", "images": _images, "frames": _clock.frames, "time": _clock.time})


func _names(rows: Array) -> PackedStringArray:
	var names: PackedStringArray = []
	for row in rows:
		names.append(row["name"])
	return names


# --- one camera stop -------------------------------------------------------------------------------

func _stages(shot: String, views: Variant, ablations: Variant) -> void:
	await RenderingServer.frame_post_draw
	Engine.time_scale = 0.0
	var hidden := _hide_particles()
	var overlay_visible: bool = _main.overlay.visible
	_main.overlay.visible = false
	_emit(_state(shot))

	for view in views:
		_viewport.debug_draw = VIEWS[view]
		await _capture(shot, view)
	_viewport.debug_draw = Viewport.DEBUG_DRAW_DISABLED

	var environment: Environment = _main.arena.environment
	var key: DirectionalLight3D = _main.arena._key
	var lights := _lights()
	for row in ABLATIONS:
		if not ablations.has(row["name"]):
			continue
		if row.has("needs") and not environment.get(row["needs"]):
			continue
		var saved := {}
		for property in BARE:
			if not row["keep"].has(property):
				_override(environment, saved, property, BARE[property])
		var sets: Array = row["set"] if row["set"] is Array else [row["set"]]
		for group in sets:
			for property in group:
				_override(environment, saved, property, group[property])
		var shadow_was := key.shadow_enabled
		key.shadow_enabled = row["shadow"]
		var visibility := _show_lights(lights, row["lights"])
		await _capture(shot, row["name"])
		for property in saved:
			environment.set(property, saved[property])
		key.shadow_enabled = shadow_was
		for light in visibility:
			light.visible = visibility[light]

	for node in hidden:
		node.visible = true
	_main.overlay.visible = overlay_visible
	# Let the temporal effects forget the ablations before time runs again.
	for i in SETTLE_FRAMES:
		await RenderingServer.frame_post_draw
	Engine.time_scale = 1.0


func _override(environment: Environment, saved: Dictionary, property: String, value: Variant) -> void:
	if not saved.has(property):
		saved[property] = environment.get(property)
	environment.set(property, value)


func _capture(shot: String, stage: String) -> void:
	for i in SETTLE_FRAMES:
		await RenderingServer.frame_post_draw
	var image := _viewport.get_texture().get_image()
	var file := "%s.%s.png" % [shot, stage]
	image.save_png(_out.path_join(file))
	_images += 1
	_emit({"k": "image", "shot": shot, "stage": stage, "file": file, "size": [image.get_width(), image.get_height()],
		"frames": _clock.frames, "time": _clock.time})


func _hide_particles() -> Array:
	var hidden := []
	for node in _all(_main):
		if (node is GPUParticles3D or node is CPUParticles3D) and node.visible:
			node.visible = false
			hidden.append(node)
	return hidden


func _lights() -> Array:
	var lights := []
	for node in _all(_main):
		if node is Light3D:
			lights.append(node)
	return lights


## Leaves visible only the lights of `group` ("all", "none", "key", "fill", "omni"); returns what to restore.
func _show_lights(lights: Array, group: String) -> Dictionary:
	var before := {}
	for light: Light3D in lights:
		var keep := true
		match group:
			"none":
				keep = false
			"key":
				keep = light == _main.arena._key
			"fill":
				keep = light == _main.arena._fill
			"omni":
				keep = light is OmniLight3D
		if not keep and light.visible:
			before[light] = true
			light.visible = false
	return before


# --- state -----------------------------------------------------------------------------------------

func _state(shot: String) -> Dictionary:
	var camera := _viewport.get_camera_3d()
	var rig: CameraRig = _main.rig
	var arena: Arena = _main.arena
	var environment := {}
	for property in ENVIRONMENT_PROPERTIES:
		environment[property] = _plain(arena.environment.get(property))
	var lights := []
	var geometry := []
	for node in _all(_main):
		if node is Light3D:
			lights.append(_light(node))
		elif node is GeometryInstance3D:
			geometry.append(_geometry(node))
	var pieces := []
	for id in _main.piece_views:
		var view: PieceView = _main.piece_views[id]
		pieces.append({"id": id, "kind": view.kind, "friendly": view.friendly, "level": view.level, "xf": _xf(view.global_transform),
			"body": _xf(view.body.global_transform), "glow": view._glow, "lift": view._lift, "time": view._time})
	var flames := []
	for flame in arena._flames:
		flames.append({"energy": flame.energy, "speed": flame.speed, "phase": flame.phase, "flicker": flame.flicker,
			"now": (flame.light as Light3D).light_energy})
	return {
		"k": "state", "shot": shot, "frames": _clock.frames, "time": _clock.time,
		"process_frames": Engine.get_process_frames(), "frames_drawn": Engine.get_frames_drawn(),
		"viewport": _v2(_viewport.get_visible_rect().size),
		"camera": {"xf": _xf(camera.global_transform), "fov": camera.fov, "near": camera.near, "far": camera.far,
			"keep_aspect": camera.keep_aspect, "projection": _projection(camera.get_camera_projection())},
		"rig": {"yaw": rig.yaw, "pitch": rig.pitch, "zoom": rig.zoom, "focus": _v3(rig.focus), "trauma": rig.trauma, "time": rig._time},
		"arena": {"variant": arena.variant, "flicker_time": arena._flicker_time, "mood": _v2(arena._mood), "flames": flames},
		"hover_cell": [_main.hover_cell.x, _main.hover_cell.y], "screen": _main.screen, "busy": _main.busy,
		"environment": environment, "lights": lights, "geometry": geometry, "pieces": pieces,
	}


func _light(light: Light3D) -> Dictionary:
	var params := {}
	for name in LIGHT_PARAMS:
		params[name] = light.get_param(LIGHT_PARAMS[name])
	var entry := {
		"path": str(_main.get_path_to(light)), "class": light.get_class(), "visible": light.is_visible_in_tree(),
		"xf": _xf(light.global_transform), "color": _color(light.light_color), "negative": light.light_negative,
		"shadow": light.shadow_enabled, "cull_mask": light.light_cull_mask, "bake_mode": light.light_bake_mode, "params": params,
	}
	if light is DirectionalLight3D:
		entry["shadow_mode"] = (light as DirectionalLight3D).directional_shadow_mode
		entry["blend_splits"] = (light as DirectionalLight3D).directional_shadow_blend_splits
		entry["sky_mode"] = (light as DirectionalLight3D).sky_mode
	elif light is OmniLight3D:
		entry["omni_shadow_mode"] = (light as OmniLight3D).omni_shadow_mode
	return entry


func _geometry(node: GeometryInstance3D) -> Dictionary:
	var aabb := node.get_aabb()
	var entry := {
		"path": str(_main.get_path_to(node)), "class": node.get_class(), "visible": node.is_visible_in_tree(),
		"xf": _xf(node.global_transform), "aabb": [aabb.position.x, aabb.position.y, aabb.position.z, aabb.size.x, aabb.size.y, aabb.size.z],
		"cast_shadow": node.cast_shadow, "layers": node.layers, "transparency": node.transparency,
		"override": _material(node.material_override), "overlay": _material(node.material_overlay),
	}
	if node is MeshInstance3D:
		var mesh := (node as MeshInstance3D).mesh
		var surfaces := []
		if mesh != null:
			for i in mesh.get_surface_count():
				var material := (node as MeshInstance3D).get_active_material(i)
				surfaces.append(_material(material))
			entry["mesh"] = mesh.get_class()
		entry["surfaces"] = surfaces
	elif node is MultiMeshInstance3D:
		var multimesh := (node as MultiMeshInstance3D).multimesh
		if multimesh != null:
			entry["instances"] = multimesh.instance_count
			entry["visible_instances"] = multimesh.visible_instance_count
			var surfaces := []
			if multimesh.mesh != null:
				for i in multimesh.mesh.get_surface_count():
					surfaces.append(_material(multimesh.mesh.surface_get_material(i)))
			entry["surfaces"] = surfaces
	elif node is Label3D:
		entry["text"] = (node as Label3D).text
	return entry


func _material(material: Material) -> Variant:
	if material == null:
		return null
	if material is ShaderMaterial:
		var shader := (material as ShaderMaterial).shader
		var parameters := {}
		if shader != null:
			for uniform in shader.get_shader_uniform_list():
				var value: Variant = (material as ShaderMaterial).get_shader_parameter(uniform.name)
				if not (value is Object):
					parameters[uniform.name] = _plain(value)
		return {"class": "ShaderMaterial", "shader": shader.resource_path if shader != null else "", "mode": shader.get_mode() if shader != null else -1,
			"priority": material.render_priority, "parameters": parameters}
	if material is BaseMaterial3D:
		var m := material as BaseMaterial3D
		return {"class": material.get_class(), "albedo": _color(m.albedo_color), "roughness": m.roughness, "metallic": m.metallic,
			"specular": m.metallic_specular, "emission_enabled": m.emission_enabled, "emission": _color(m.emission),
			"emission_energy": m.emission_energy_multiplier, "transparency": m.transparency, "blend": m.blend_mode, "cull": m.cull_mode,
			"shading": m.shading_mode, "vertex_color_albedo": m.vertex_color_use_as_albedo, "rim_enabled": m.rim_enabled, "rim": m.rim,
			"rim_tint": m.rim_tint, "no_depth_test": m.no_depth_test, "disable_fog": m.disable_fog,
			"disable_receive_shadows": m.disable_receive_shadows, "billboard": m.billboard_mode, "priority": m.render_priority,
			"texture": m.albedo_texture != null, "diffuse_mode": m.diffuse_mode, "specular_mode": m.specular_mode,
			"depth_draw": m.depth_draw_mode}
	return {"class": material.get_class()}


func _project_settings() -> Dictionary:
	var keys: PackedStringArray = [
		"rendering/anti_aliasing/quality/msaa_3d",
		"rendering/lights_and_shadows/directional_shadow/size",
		"rendering/lights_and_shadows/directional_shadow/soft_shadow_filter_quality",
		"rendering/lights_and_shadows/directional_shadow/16_bits",
		"rendering/lights_and_shadows/positional_shadow/soft_shadow_filter_quality",
		"rendering/anti_aliasing/screen_space_roughness_limiter/enabled",
		"rendering/anti_aliasing/screen_space_roughness_limiter/amount",
		"rendering/anti_aliasing/screen_space_roughness_limiter/limit",
		"rendering/environment/ssao/quality", "rendering/environment/ssao/half_size",
		"rendering/environment/ssao/adaptive_target", "rendering/environment/ssao/blur_passes",
		"rendering/environment/ssao/fadeout_from", "rendering/environment/ssao/fadeout_to",
		"rendering/environment/ssil/quality", "rendering/environment/ssil/half_size",
		"rendering/environment/ssil/adaptive_target", "rendering/environment/ssil/blur_passes",
		"rendering/environment/ssil/fadeout_from", "rendering/environment/ssil/fadeout_to",
		"rendering/environment/glow/upscale_mode",
		"rendering/environment/volumetric_fog/volume_size", "rendering/environment/volumetric_fog/volume_depth",
		"rendering/environment/volumetric_fog/use_filter",
		"rendering/reflections/sky_reflections/roughness_layers", "rendering/reflections/sky_reflections/ggx_samples",
		"rendering/reflections/sky_reflections/texture_array_reflections",
		"rendering/reflections/sky_reflections/fast_filter_high_quality",
		"rendering/reflections/specular_occlusion/enabled",
		"rendering/limits/cluster_builder/max_clustered_elements",
		"rendering/driver/depth_prepass/enable",
		"rendering/shading/overrides/force_vertex_shading", "rendering/shading/overrides/force_lambert_over_burley",
		"rendering/textures/default_filters/anisotropic_filtering_level",
		"rendering/viewport/hdr_2d", "rendering/scaling_3d/mode", "rendering/scaling_3d/scale",
		"rendering/camera/depth_of_field/depth_of_field_bokeh_quality",
		"display/window/size/viewport_width", "display/window/size/viewport_height",
		"display/window/stretch/mode", "display/window/stretch/aspect",
	]
	var values := {}
	for key in keys:
		values[key] = _plain(ProjectSettings.get_setting(key)) if ProjectSettings.has_setting(key) else null
	return values


# --- helpers ---------------------------------------------------------------------------------------

## Accumulates the scaled frame steps from the first frame: the value shaders read as TIME.
func _make_clock() -> Node:
	var script := GDScript.new()
	script.source_code = "extends Node\nvar time := 0.0\nvar frames := 0\nfunc _process(delta: float) -> void:\n\ttime += delta\n\tframes += 1\n"
	script.reload()
	var node := Node.new()
	node.name = "OracleClock"
	node.set_script(script)
	return node


func _wait(seconds: float) -> void:
	await _tree.create_timer(seconds).timeout


func _all(root: Node) -> Array:
	var found := []
	var stack := [root]
	while not stack.is_empty():
		var node: Node = stack.pop_back()
		found.append(node)
		var children := node.get_children(true)
		children.reverse()
		stack.append_array(children)
	return found


func _xf(t: Transform3D) -> Array:
	var b := t.basis
	return [b.x.x, b.x.y, b.x.z, b.y.x, b.y.y, b.y.z, b.z.x, b.z.y, b.z.z, t.origin.x, t.origin.y, t.origin.z]


func _projection(p: Projection) -> Array:
	return [p.x.x, p.x.y, p.x.z, p.x.w, p.y.x, p.y.y, p.y.z, p.y.w, p.z.x, p.z.y, p.z.z, p.z.w, p.w.x, p.w.y, p.w.z, p.w.w]


func _v2(v: Vector2) -> Array:
	return [v.x, v.y]


func _v3(v: Vector3) -> Array:
	return [v.x, v.y, v.z]


func _color(c: Color) -> Array:
	return [c.r, c.g, c.b, c.a]


func _plain(value: Variant) -> Variant:
	match typeof(value):
		TYPE_COLOR:
			return _color(value)
		TYPE_VECTOR2:
			return _v2(value)
		TYPE_VECTOR3:
			return _v3(value)
		TYPE_VECTOR4:
			return [value.x, value.y, value.z, value.w]
		TYPE_TRANSFORM3D:
			return _xf(value)
		TYPE_OBJECT:
			return null
	return value
