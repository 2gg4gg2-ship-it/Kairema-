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
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: androidDebug,
  },
  plugins: {
    KairemaLoopback: {
      apiBaseUrl: apiBaseUrl || "",
      debugDiagnostics: androidDebug,
    },
  },
};

export default config;