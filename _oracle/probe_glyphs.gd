extends RefCounted
## Oracle probe — the glyph bitmaps of the original, straight from the text server's cache.
## For every font of the game: every glyph its shaper produces for the corpus (so ligatures and
## feature alternates are included), at the sizes the interface uses, in every sub-pixel variant
## (4 up to 16 px, 2 up to 20 px), plus the outlined glyphs of the floating 3D texts.
##   glyphs   {font, size, outline, rows: [[glyph, variant, off_x, off_y, w, h, bytes]…], data}
##            rows describe consecutive slices of `data`: the alpha channel of each glyph's atlas
##            rectangle (1 px margin included), DEFLATE-compressed, base64.

const SIZES := [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 26, 28, 30, 34, 38, 44, 52, 56, 60, 72, 96]
const OUTLINE_SIZES := [52, 54, 56, 60]
const OUTLINE := 14
const SHAPING_SIZE := 24
const QUARTER_MAX := 16
const HALF_MAX := 20


func _emit(entry: Dictionary) -> void:
	print("ORACLE ", JSON.stringify(entry, "", false, true))


func run(_host: Node) -> void:
	var corpus_path: String = (get_script() as GDScript).resource_path.get_base_dir().path_join("font_corpus.json")
	var corpus: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(corpus_path))
	var fonts := {
		"display": UiTheme.display_font(), "caps": UiTheme.caps_font(), "body": UiTheme.body_font(),
		"bold": UiTheme.bold_font(), "italic": UiTheme.italic_font(), "numbers": UiTheme.number_font(),
	}
	var ts := TextServerManager.get_primary_interface()
	for name in fonts:
		var font: Font = fonts[name]
		var rid: RID = font.get_rids()[0]
		var glyphs := _glyph_set(ts, font, corpus.strings, corpus.charset)
		_emit({"k": "set", "font": name, "glyphs": glyphs})
		for size in SIZES:
			_dump(ts, rid, name, size, 0, glyphs)
		if name == "display":
			for size in OUTLINE_SIZES:
				_dump(ts, rid, name, size, OUTLINE, glyphs)


## Every glyph index the shaper outputs for the corpus and the character set, sorted.
func _glyph_set(ts: TextServer, font: Font, strings: Array, charset: String) -> Array:
	var seen := {}
	var texts := strings.duplicate()
	texts.append(charset)
	for text in texts:
		var line := TextLine.new()
		line.add_string(text, font, SHAPING_SIZE)
		for g: Dictionary in ts.shaped_text_get_glyphs(line.get_rid()):
			if int(g.index) != 0 and g.font_rid == font.get_rids()[0]:
				seen[int(g.index)] = true
	var out := seen.keys()
	out.sort()
	return out


func _dump(ts: TextServer, rid: RID, name: String, size: int, outline: int, glyphs: Array) -> void:
	var key := Vector2i(size, outline)
	var variants := 4 if size <= QUARTER_MAX else (2 if size <= HALF_MAX else 1)
	var rows := []
	var data := PackedByteArray()
	for glyph: int in glyphs:
		for variant in variants:
			var index := glyph | (variant << 27)
			ts.font_render_glyph(rid, key, index)
			var uv: Rect2 = ts.font_get_glyph_uv_rect(rid, key, index)
			var offset: Vector2 = ts.font_get_glyph_offset(rid, key, index)
			var bytes := PackedByteArray()
			if uv.size.x > 0 and uv.size.y > 0:
				var atlas: Image = ts.font_get_texture_image(rid, key, ts.font_get_glyph_texture_idx(rid, key, index))
				bytes = _alpha(atlas, Rect2i(uv.position, uv.size))
			rows.append([glyph, variant, offset.x, offset.y, int(uv.size.x), int(uv.size.y), bytes.size()])
			data.append_array(bytes)
	_emit({"k": "glyphs", "font": name, "size": size, "outline": outline, "rows": rows,
		"bytes": data.size(), "data": Marshalls.raw_to_base64(data.compress(FileAccess.COMPRESSION_DEFLATE))})


## The alpha channel of an atlas rectangle, row by row (LA8: 2 bytes per pixel, alpha second).
func _alpha(atlas: Image, rect: Rect2i) -> PackedByteArray:
	var out := PackedByteArray()
	out.resize(rect.size.x * rect.size.y)
	var source := atlas.get_data()
	var step := 2 if atlas.get_format() == Image.FORMAT_LA8 else 4
	var channel := 1 if step == 2 else 3
	var width := atlas.get_width()
	var at := 0
	for y in rect.size.y:
		var row := ((rect.position.y + y) * width + rect.position.x) * step + channel
		for x in rect.size.x:
			out[at] = source[row + x * step]
			at += 1
	return out
