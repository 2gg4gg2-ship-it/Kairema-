# Loopback payload check

Answers one question with evidence: **does the Android WebView path hand the backend the exact bytes
the browser path does?**

- Web: `browser -> https://<backend>`
- Android: `WebView -> http://127.0.0.1:<port> (LoopbackHttpCore) -> https://<backend>`

The proxy in between is the only Kairema-owned component in that path, so if a sign-in behaves
differently on the phone, the first question is whether the proxy changed the request. This check
answers it by execution rather than by reading code.

## What it does

1. Builds the request with the project's own `@trpc/client` + `superjson`, so the wire format is the
   real one, not a hand-written approximation.
2. Sends those exact raw bytes twice: once straight to a local recording upstream, and once through
   the **real** `LoopbackHttpCore`, compiled from `android/app/src/main/java`.
3. Compares method, path, query, `Content-Type`, body length and body bytes (SHA-256) as received by
   the upstream, across four payload shapes (ASCII, non-ASCII, JSON/percent hostile, 200 KiB) and both
   body framings (`Content-Length` and `Transfer-Encoding: chunked`).
4. Checks response integrity in the other direction: repeated `Set-Cookie` lines survive, and a 401
   status line plus its tRPC error body reach the WebView intact.

No credential is ever printed. Bodies are only reported as a byte count, a truncated SHA-256, and
whether the expected JSON fields are present.

## Running it

```bash
JAVA_HOME=/path/to/jdk-21 pnpm check:loopback-payload
```

Needs Node (already required) and a JDK 21, which the Android debug APK workflow installs. Exits
non-zero if any check fails.
