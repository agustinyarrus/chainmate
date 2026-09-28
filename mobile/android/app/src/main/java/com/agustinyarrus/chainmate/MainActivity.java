package com.agustinyarrus.chainmate;

import android.os.Bundle;
import android.view.WindowManager;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

/**
 * Chainmate on Android: the web build inside Capacitor's WebView, immersive full screen, landscape,
 * the screen kept on, and the system Back button handed to the game (window.chainmate.backButton():
 * the desktop game's Escape — close the open screen, drop the selection, pause). On the bare main
 * menu the game answers "exit" and the task goes to the background instead of being killed.
 */
public class MainActivity extends BridgeActivity {

    /** What the game answers when Back has nothing left to close. */
    private static final String BACK_EXIT = "exit";

    /** Asks the game what Back means right now; before the game has loaded, the answer is to leave. */
    private static final String ASK_GAME_ABOUT_BACK =
        "(function(){ try { return window.chainmate && window.chainmate.backButton ? window.chainmate.backButton() : 'exit'; } catch (e) { return 'exit'; } })()";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        applyImmersive();
        // Back through AndroidX's dispatcher, not onBackPressed(): with targetSdk 36 on Android 16 the
        // system no longer calls onBackPressed nor delivers KEYCODE_BACK (predictive back), but it does
        // invoke registered OnBackPressedCallbacks; older versions reach the same dispatcher the classic
        // way. Always enabled: the game decides, and leaving is ours to do (task to the background).
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() { askGameAboutBack(); }
        });
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyImmersive();
    }

    /** System bars hidden (sticky immersive): a swipe from the edge shows them for a moment. */
    private void applyImmersive() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (controller != null) {
            controller.hide(WindowInsetsCompat.Type.systemBars());
            controller.setSystemBarsBehavior(
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        }
    }

    /** Back: the game decides ('handled' or 'exit'). */
    private void askGameAboutBack() {
        if (bridge == null || bridge.getWebView() == null) { moveTaskToBack(true); return; }
        bridge.getWebView().evaluateJavascript(ASK_GAME_ABOUT_BACK,
            value -> { if (value != null && value.contains(BACK_EXIT)) runOnUiThread(() -> moveTaskToBack(true)); });
    }
}
