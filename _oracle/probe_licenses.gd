extends RefCounted
## Oracle probe — the licence texts the Credits panel shows (Engine.get_license_text,
## get_copyright_info, get_license_info), so the port's credits are identical.


func run(_host: Node) -> void:
	var components := []
	for component: Dictionary in Engine.get_copyright_info():
		var parts := []
		for part: Dictionary in component.parts:
			parts.append({"copyright": Array(part.copyright), "license": str(part.license)})
		components.append({"name": str(component.name), "parts": parts})
	var entry := {"k": "licenses", "license_text": Engine.get_license_text(), "components": components, "license_info": Engine.get_license_info()}
	print("ORACLE ", JSON.stringify(entry, "", false, true))
