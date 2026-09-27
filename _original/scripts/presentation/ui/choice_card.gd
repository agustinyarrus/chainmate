class_name ChoiceCard
extends PanelContainer



signal chosen

var icon: = ""
var piece_kind: = ""
var _button: Button
var _hover: = false
var _icon_view: Control


static func make(icon_name: String, heading: String, body: String, button_text: String, footer: = "", kind: = "") -> ChoiceCard:
	var card: = ChoiceCard.new()
	card.icon = icon_name
	card.piece_kind = kind
	card.custom_minimum_size = Vector2(230, 300)
	var column: = UiKit.vbox(10)
	column.alignment = BoxContainer.ALIGNMENT_BEGIN
	card.add_child(column)
	card._icon_view = IconView.new()
	card._icon_view.icon = icon_name
	card._icon_view.piece_kind = kind
	card._icon_view.custom_minimum_size = Vector2(0, 100)
	column.add_child(card._icon_view)
	var name_label: = UiKit.title(heading, 21, Palette.INK)
	name_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	name_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	column.add_child(name_label)
	var text: = UiKit.wrap(body, 18, Palette.MUTED, 190)
	text.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	column.add_child(text)
	column.add_child(UiKit.spacer(false))
	if footer != "":
		var foot: = UiKit.caption(footer, Palette.GOLD, 12)
		foot.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		column.add_child(foot)
	card._button = UiKit.button(button_text, card._choose)
	card._button.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	card._button.custom_minimum_size.x = 140
	column.add_child(card._button)
	return card


func _ready() -> void :
	mouse_filter = Control.MOUSE_FILTER_PASS
	mouse_entered.connect(_set_hover.bind(true))
	mouse_exited.connect(_set_hover.bind(false))
	_button.focus_entered.connect(_restyle)
	_button.focus_exited.connect(_restyle)
	_restyle()


func set_enabled(on: bool, reason: = "") -> void :
	_button.disabled = not on
	_button.tooltip_text = reason
	modulate.a = 1.0 if on else 0.6


func focus_button() -> void :
	_button.grab_focus.call_deferred()


func _set_hover(on: bool) -> void :
	_hover = on
	_restyle()


func _restyle() -> void :
	var lit: = (_hover or _button.has_focus()) and not _button.disabled
	add_theme_stylebox_override("panel", UiTheme.glow_box() if lit else UiTheme.box(Color(0.045, 0.065, 0.1, 0.95), Palette.PANEL_EDGE, 1, 4, Vector4(18, 16, 18, 16)))


func _choose() -> void :
	chosen.emit()



class IconView:
	extends Control
	var icon: = ""
	var piece_kind: = ""

	func _draw() -> void :
		var centre: = size * 0.5
		var radius: = minf(size.x, size.y) * 0.42
		draw_circle(centre, radius * 1.15, Color(Palette.ACCENT, 0.06))
		if piece_kind != "":
			Emblems.draw_piece(self, piece_kind, centre + Vector2( - radius * 0.35, 0), radius * 0.85, Palette.INK)
			if icon != "":
				Icons.draw(self, icon, centre + Vector2(radius * 0.55, radius * 0.25), radius * 0.55)
		else:
			Icons.draw(self, icon, centre, radius)
