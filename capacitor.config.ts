import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Android shell configuration.
 *
 * The APK bundles the built web app and serves it from a loopback HTTP origin created in-process
 * (see android/.../loopback). `server.url` is deliberately NOT set: pointing Capacitor at the
 * production host would turn the release build into an unverifiable thin client and make signed OTA
 * updates meaningless.
 *
 * `apiBaseUrl` is the fixed upstream the loopback proxy forwards the Kairema allowlist to. It comes
 * from the environment and has no committed default, so no backend host is baked into the
 * repository. When it is absent the proxy refuses to start rather than guessing a host.
 */
const apiBaseUrl = process.env.KAIREMA_API_BASE_URL?.trim();

/**
 * Debug-only switches. Both are driven by the single KAIREMA_ANDROID_DEBUG=1 build variable so a
 * release build can never turn them on: there is no way to reach them from the device.
 *
 * debugDiagnostics additionally gates the on-device diagnostics log and fallback screen, which exist
 * because the user has no PC, adb or logcat and the loopback failure must be readable on the phone.
 */
const androidDebug = process.env.KAIREMA_ANDROID_DEBUG === "1";

const config: CapacitorConfig = {
  appId: process.env.KAIREMA_ANDROID_APP_ID?.trim() || "im.kairema.app",
  appName: "Kairema",
  webDir: "dist/public",
  // `url` is deliberately left unset: the app serves itself from the in-process loopback origin.
  server: {
    // Capacitor decides, per navigation, whether the WebView may follow it or whether it must be
    // handed to the system browser. It compares the host against `appUrl`, which without `server.url`
    // is Capacitor's own default `https://localhost`. The shell actually runs on
    // `http://127.0.0.1:<port>`, so every in-page navigation to our own origin - the post-login
    // `window.location.assign("/")`, an OAuth landing, any client-side route change - was treated as
    // external and fired an ACTION_VIEW intent, leaving the session cookie in another app.
    // Listing the loopback host keeps those navigations inside this WebView. This is navigation
    // policy only: no remote URL is introduced and `server.url` stays unset.
    allowNavigation: ["127.0.0.1"],
  },
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: androidDebug,
    // The native bridge must be reachable from the app-owned loopback origin, or nothing on the page
    // can tell it is running inside the shell.
    //
    // On the default (modern) path Capacitor injects `window.androidBridge` with
    // `WebViewCompat.addWebMessageListener`, which only fires for origins in its allowlist. That
    // allowlist is built from `allowNavigation` above, and an entry that does not begin with "http"
    // is prefixed with "https://". So the sole rule is `https://127.0.0.1`, while the page really
    // runs on `http://127.0.0.1:<port>` - different scheme, and a port chosen at runtime. The two
    // never match, the bridge is never injected, and `Capacitor.getPlatform()` reports "web".
    // Every native-only affordance then disappears, which is why the on-device Terminal was not
    // reachable at all: the client correctly hides it unless the platform is "android".
    //
    // This cannot be fixed from `allowNavigation` alone. Adding the scheme would still leave the
    // ephemeral port out of the rule, and the port is not knowable when the config is written.
    //
    // The legacy path injects the same bridge through `addJavascriptInterface`, which is not
    // origin-scoped, so it reaches the loopback origin whatever its port. The exposure is bounded
    // here because this WebView only ever loads the app-owned loopback origin, `server.url` is
    // unset and `allowNavigation` still confines in-app navigation to `127.0.0.1`.
    useLegacyBridge: true,
  },
  plugins: {
    KairemaLoopback: {
      apiBaseUrl: apiBaseUrl || "",
      debugDiagnostics: androidDebug,
    },
  },
};

export default config;