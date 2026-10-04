/**
 * Web-side startup timing, for the "stuck on the welcome screen" investigation.
 *
 * <p>The native diagnostics log records the loopback hop and the upstream leg of every request. This
 * module records the leg that only the page can see: the moment `fetch` is called and the moment its
 * promise settles. Those two instants, plus the elapsed time between them, are the only way to tell
 * apart a request the page never issued, a request the page issued and never got an answer for, and a
 * request that answered quickly while the page failed anyway.
 *
 * <p>What is deliberately not recorded here: request bodies, response bodies, headers, cookies and
 * tokens. The route is reduced to a fixed label and no credential ever reaches this code. Every entry
 * is written to the console, which is where a WebView logcat excerpt is read from, and the native
 * `DebugLog` schema version is reported alongside so the two streams can be matched.
 */

let sequence = 0;

/**
 * Correlation id for one page-side request, in the same `d<n>` shape the native loopback listener
 * uses. Independent counters are the point: a reader can tell a page-side line from a native one.
 */
export function nextDiagId(): string {
  sequence += 1;
  return `d${sequence.toString(16)}`;
}

/** A coarse route label. Paths are classified, never echoed, so nothing identifying is recorded. */
export function routeLabel(path: string, method: string): string {
  if (path.startsWith("/api/trpc")) return "trpc";
  if (path.startsWith("/api/")) return "api";
  if (method === "GET" && path.endsWith("/")) return "document";
  return "asset";
}

function emit(id: string, fields: Record<string, string | number | boolean>): void {
  const parts = [`[diag]`, `corr=${id}`];
  for (const [key, value] of Object.entries(fields)) {
    parts.push(`${key}=${String(value)}`);
  }
  // eslint-disable-next-line no-console
  console.info(parts.join("; "));
}

/** Marks the start of a fetch, returning a finish function that reports the outcome once. */
export function startDiagFetch(
  id: string,
  method: string,
  path: string,
): (outcome: "ok" | "error", status?: number) => void {
  const startedAtMs = Date.now();
  emit(id, {
    phase: "fetch_start",
    method,
    route: routeLabel(path, method),
  });

  let reported = false;
  return (outcome: "ok" | "error", status?: number) => {
    if (reported) return;
    reported = true;
    const totalMs = Date.now() - startedAtMs;
    emit(id, {
      phase: "fetch_end",
      outcome,
      ...(typeof status === "number" ? { status } : {}),
      totalMs,
    });
  };
}

/**
 * Times the `auth.me` round trip, the one request that gates the welcome screen.
 *
 * <p>Reported as its own named step rather than as an anonymous fetch, because it is the only
 * network call made before the user sees anything, and the elapsed time is what has to be explained.
 */
export function reportAuthMe(id: string, outcome: "ok" | "error", status: number | undefined, ms: number): void {
  emit(id, {
    phase: "auth_me",
    outcome,
    ...(typeof status === "number" ? { status } : {}),
    ms,
  });
}