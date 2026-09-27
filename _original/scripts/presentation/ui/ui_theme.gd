class_name UiTheme
extends RefCounted



const DISPLAY_FONT: = "res://assets/fonts/Cinzel-Variable.ttf"
const BODY_FONT: = "res://assets/fonts/CormorantGaramond-Variable.ttf"
const ITALIC_FONT: = "res://assets/fonts/CormorantGaramond-Italic-Variable.ttf"

static var _theme: Theme
static var _display: Font
static var _caps: Font
static var _body: Font
static var _body_bold: Font
static var _italic: Font
static var _numbers: Font


static func theme() -> Theme:
	if _theme == null:
		_theme = _build()
	return _theme



static func display_font() -> Font:
	theme()
	return _display



static func caps_font() -> Font:
	theme()
	return _caps


static func body_font() -> Font:
	theme()
	return _body


static func bold_font() -> Font:
	theme()
	return _body_bold



static func italic_font() -> Font:
	theme()
	return _italic



static func number_font() -> Font:
	theme()
	return _numbers


static func box(fill: Color, edge: = Color.TRANSPARENT, border: = 0, radius: = 3, pad: = Vector4(14, 10, 14, 10)) -> StyleBoxFlat:
	var style: = StyleBoxFlat.new()
	style.bg_color = fill
	style.border_color = edge
	style.set_border_width_all(border)
	style.set_corner_radius_all(radius)
	style.content_margin_left = pad.x
	style.content_margin_top = pad.y
	style.content_margin_right = pad.z
	style.content_margin_bottom = pad.w
	style.anti_aliasing = true
	return style



static func glow_box(pad: = Vector4(18, 16, 18, 16)) -> StyleBoxFlat:
	var style: = box(Color(0.06, 0.1, 0.17, 0.96), Palette.ACCENT, 1, 4, pad)
	style.shadow_color = Palette.ACCENT_GLOW
	style.shadow_size = 12
	return style


static func _variation(path: String, weight: float, tracking: = 0) -> FontVariation:
	var file: FontFile = load(path)
	var font: = FontVariation.new()
	font.base_font = file
	var server: = TextServerManager.get_primary_interface()
	font.variation_opentype = {server.name_to_tag("wght"): weight}
	font.spacing_glyph = tracking
	return font


static func _build() -> Theme:
	_display = _variation(DISPLAY_FONT, 600.0, 1)
	_caps = _variation(DISPLAY_FONT, 560.0, 3)
	_body = _variation(BODY_FONT, 520.0)
	_body_bold = _variation(BODY_FONT, 700.0)
	_italic = _variation(ITALIC_FONT, 500.0)
	var numbers: = _variation(BODY_FONT, 600.0)
	numbers.opentype_features = {TextServerManager.get_primary_interface().name_to_tag("lnum"): 1, TextServerManager.get_primary_interface().name_to_tag("tnum"): 1}
	_numbers = numbers

	var t: = Theme.new()
	t.default_font = _body
	t.default_font_size = 20

	t.set_color("font_color", "Label", Palette.INK)
	t.set_color("font_shadow_color", "Label", Color(0, 0, 0, 0.6))
	t.set_constant("shadow_offset_x", "Label", 0)
	t.set_constant("shadow_offset_y", "Label", 1)

	var pad: = Vector4(20, 9, 20, 10)
	t.set_stylebox("normal", "Button", box(Color(0.05, 0.075, 0.115, 0.94), Palette.PANEL_EDGE_STRONG, 1, 3, pad))
	t.set_stylebox("hover", "Button", box(Color(0.07, 0.11, 0.18, 0.97), Palette.ACCENT, 1, 3, pad))
	t.set_stylebox("pressed", "Button", box(Color(0.09, 0.15, 0.26, 0.98), Palette.ACCENT, 1, 3, pad))
	t.set_stylebox("disabled", "Button", box(Color(0.04, 0.05, 0.075, 0.7), Color(1, 1, 1, 0.06), 1, 3, pad))
	var focus: = box(Color.TRANSPARENT, Palette.ACCENT, 2, 4, Vector4.ZERO)
	focus.draw_center = false
	t.set_stylebox("focus", "Button", focus)
	t.set_color("font_color", "Button", Palette.INK)
	t.set_color("font_hover_color", "Button", Color.WHITE)
	t.set_color("font_pressed_color", "Button", Color.WHITE)
	t.set_color("font_focus_color", "Button", Palette.INK)
	t.set_color("font_disabled_color", "Button", Palette.FAINT)
	t.set_font("font", "Button", _display)
	t.set_font_size("font_size", "Button", 16)

	t.set_stylebox("panel", "PanelContainer", box(Palette.PANEL, Palette.PANEL_EDGE, 1, 4, Vector4(22, 18, 22, 18)))
	t.set_stylebox("panel", "Panel", box(Palette.PANEL, Palette.PANEL_EDGE, 1, 4))

	t.set_stylebox("panel", "TooltipPanel", box(Color(0.03, 0.045, 0.075, 0.97), Palette.PANEL_EDGE_STRONG, 1, 3, Vector4(12, 8, 12, 8)))
	t.set_color("font_color", "TooltipLabel", Palette.INK)
	t.set_font_size("font_size", "TooltipLabel", 18)

	t.set_stylebox("normal", "LineEdit", box(Color(0.03, 0.045, 0.075, 0.95), Palette.PANEL_EDGE_STRONG, 1, 3, Vector4(12, 8, 12, 8)))
	t.set_stylebox("focus", "LineEdit", box(Color(0.03, 0.045, 0.075, 0.95), Palette.ACCENT, 1, 3, Vector4(12, 8, 12, 8)))
	t.set_color("font_color", "LineEdit", Palette.INK)
	t.set_color("font_placeholder_color", "LineEdit", Palette.FAINT)
	t.set_color("caret_color", "LineEdit", Palette.ACCENT)
	t.set_font_size("font_size", "LineEdit", 20)

	var groove: = box(Color(0.12, 0.14, 0.18, 1), Color.TRANSPARENT, 0, 2, Vector4(0, 3, 0, 3))
	t.set_stylebox("slider", "HSlider", groove)
	var fill: = box(Palette.ACCENT.darkened(0.2), Color.TRANSPARENT, 0, 2, Vector4(0, 3, 0, 3))
	t.set_stylebox("grabber_area", "HSlider", fill)
	t.set_stylebox("grabber_area_highlight", "HSlider", fill)
	t.set_icon("grabber", "HSlider", _dot_texture(18, Palette.INK))
	t.set_icon("grabber_highlight", "HSlider", _dot_texture(18, Color.WHITE))

	t.set_color("font_color", "CheckButton", Palette.INK)
	t.set_color("font_hover_color", "CheckButton", Color.WHITE)
	var flat: = box(Color.TRANSPARENT, Color.TRANSPARENT, 0, 3, Vector4(4, 4, 4, 4))
	t.set_stylebox("normal", "CheckButton", flat)
	t.set_stylebox("hover", "CheckButton", box(Color(1, 1, 1, 0.04), Color.TRANSPARENT, 0, 3, Vector4(4, 4, 4, 4)))
	t.set_stylebox("pressed", "CheckButton", flat)
	t.set_stylebox("focus", "CheckButton", focus)

	t.set_stylebox("panel", "PopupMenu", box(Color(0.03, 0.045, 0.075, 0.97), Palette.PANEL_EDGE_STRONG, 1, 3))
	t.set_stylebox("normal", "OptionButton", t.get_stylebox("normal", "Button"))
	t.set_stylebox("hover", "OptionButton", t.get_stylebox("hover", "Button"))
	t.set_stylebox("pressed", "OptionButton", t.get_stylebox("pressed", "Button"))
	t.set_stylebox("focus", "OptionButton", focus)
	t.set_font("font", "OptionButton", _body)
	t.set_font_size("font_size", "OptionButton", 18)
	t.set_font("font", "PopupMenu", _body)
	t.set_font_size("font_size", "PopupMenu", 18)

	var scroll: = box(Color(1, 1, 1, 0.04), Color.TRANSPARENT, 0, 2, Vector4.ZERO)
	t.set_stylebox("scroll", "VScrollBar", scroll)
	t.set_stylebox("grabber", "VScrollBar", box(Palette.FAINT, Color.TRANSPARENT, 0, 2, Vector4.ZERO))
	t.set_stylebox("grabber_highlight", "VScrollBar", box(Palette.MUTED, Color.TRANSPARENT, 0, 2, Vector4.ZERO))
	t.set_stylebox("grabber_pressed", "VScrollBar", box(Palette.INK, Color.TRANSPARENT, 0, 2, Vector4.ZERO))
	return t


static func _dot_texture(size: int, color: Color) -> ImageTexture:
	var image: = Image.create(size, size, false, Image.FORMAT_RGBA8)
	var center: = (size - 1) / 2.0
	for y in size:
		for x in size:
			var d: = Vector2(x - center, y - center).length()
			image.set_pixel(x, y, Color(color, clampf(center - d + 0.5, 0.0, 1.0)))
	return ImageTexture.create_from_image(image)
