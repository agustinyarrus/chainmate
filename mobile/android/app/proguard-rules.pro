# Chainmate's release build does not shrink or obfuscate (minifyEnabled false in build.gradle): the
# app is Capacitor's bridge plus the game's web files, and R8 would only risk the classes Capacitor
# finds by reflection. Rules would go here if minification is ever turned on; the bridge's own
# rules ship with the capacitor-android library.
