# On-device Terminal (Android)

A Linux shell that runs on the phone, inside the APK's own private storage.

```
WebView  →  127.0.0.1 loopback  →  /api/local/terminal/*  →  TerminalSessions
         →  TerminalSession (proot)  →  Alpine aarch64  →  /bin/sh
```

Render is not involved in running commands. The terminal is a local Android runtime, and the AI has
no access to it: there are no AI terminal tools, no MCP and no file tools. The only way in is the
loopback origin inside this app.

## What ships in the APK

| Where | File | Why there |
| --- | --- | --- |
| `lib/arm64-v8a/` | `libandroid-shmem.so` | Its name ends in `.so`, so AGP packages it normally and the platform extracts it to `nativeLibraryDir`. |
| `assets/terminal/native/arm64-v8a/` | `proot` | No `.so` extension, so AGP drops it from `lib/`. |
| `assets/terminal/native/arm64-v8a/` | `libtalloc.so.2` | Versioned SONAME, so AGP drops it from `lib/`. |
| `assets/terminal/rootfs/` | `alpine-minirootfs-3.21.8-aarch64.tar.gz` | See "The .tar.gz problem". |

### Why proot and libtalloc are assets, not `jniLibs`

This was measured on AGP 8.13.0, not assumed. Two **byte-identical** copies were placed in the same
`jniLibs/arm64-v8a/` directory in the same build:

| Source file | Result |
| --- | --- |
| `libtalloc.so` (31440 bytes) | packaged as `lib/arm64-v8a/libtalloc.so` |
| `libtalloc.so.2` (same 31440 bytes) | **dropped** |
| `proot.so` (247408 bytes) | packaged as `lib/arm64-v8a/proot.so` |
| `proot` (same 247408 bytes) | **dropped** |

AGP 8.13.0 packages a `jniLibs` entry only when its file name ends in `.so`. proot's `DT_NEEDED` is
literally `libtalloc.so.2`, and the dynamic linker resolves that by file name, so no Gradle
configuration can make standard native packaging satisfy it. Shipping those two as assets, verifying
their SHA-256, and staging them in an app-private directory is the supported alternative, and it is
the only one that actually works here.

`proot` is launched with `LD_LIBRARY_PATH` set to that app-private directory, followed by
`nativeLibraryDir` so the platform-extracted `libandroid-shmem.so` is found too. proot's own RUNPATH
points at the Termux prefix `/data/data/com.termux/files/usr/lib`, which does not exist in this app.

### The `.tar.gz` problem

The committed source file keeps its upstream name, `alpine-minirootfs-3.21.8-aarch64.tar.gz`.
**AGP rewrites it to `.tar` in the APK.** This is not aapt2: aapt2 alone was measured to preserve
`.tar.gz`. The rewrite happens in AGP's own asset-merge step, which decompresses a `.gz` asset and
strips the extension so that `AssetManager.open("name")` transparently returns gunzipped bytes.

No `noCompress` spelling changes this. All four were built and measured:

| Configuration | Name in the APK |
| --- | --- |
| (none) | `alpine-minirootfs-3.21.8-aarch64.tar` |
| `androidResources.noCompress += ['.gz']` | `alpine-minirootfs-3.21.8-aarch64.tar` |
| `androidResources.noCompress += ['gz']` | `alpine-minirootfs-3.21.8-aarch64.tar` |
| `androidResources.noCompress += ['.tar.gz']` | `alpine-minirootfs-3.21.8-aarch64.tar` |

`androidResources.noCompress` feeds `CompressAssetsTask`, a different stage, so it has no effect on
the merge. A no-op setting was left out of `build.gradle` rather than shipped looking correct.

The runtime therefore tries `.tar.gz` first and falls back to `.tar`, and additionally sniffs the
gzip magic, so it works whichever form the build produces. Both digests are pinned, so a substituted
archive is rejected either way. `verifyTerminalApk` asserts which one is actually present.

### `useLegacyPackaging`, and why it is `true`

`packaging { jniLibs { useLegacyPackaging true } }` is required. It is what sets
`android:extractNativeLibs="true"` in the packaged manifest, which `verifyTerminalApk` checks.

The AGP default is `extractNativeLibs=false`: native libraries are stored **inside** the APK
uncompressed and mapped straight out of the archive. A binary in that state cannot be `exec()`ed.
proot is not `dlopen`ed, it is executed, so the platform has to extract `lib/` to `nativeLibraryDir`
with its execute bit intact. `useLegacyPackaging=true` selects that behaviour; the name refers to the
pre-API-23 packaging model, not to the `.so` files themselves.

`nativeLibraryDir` is app-private and per-app, so extraction there grants no other app access.

## ABI and page size

* `arm64-v8a` only, via `ndk { abiFilters 'arm64-v8a' }`. The binaries are prebuilt aarch64, so there
  is nothing to build for another ABI.
* All three ELF binaries have `p_align = 0x4000` (16384) on every `PT_LOAD` segment, which is the
  16 KB page-size requirement for devices running API 35+. `verifyTerminalApk` re-checks this from the
  packaged bytes rather than trusting the note.
* `proot` is a PIE (`ET_DYN`), which is what Android's loader expects.
* API level: `minSdk 24`, `targetSdk 36`.

## Runtime layout

Everything lives under `filesDir/terminal-runtime/`, which no other app can read or write:

```
terminal-runtime/
  bin/proot                 0755, extracted from assets after digest verification
  lib/libtalloc.so.2        digest verified
  rootfs/                   the extracted Alpine tree
  rootfs/home/kairema       the session's working directory
  .installed                written only after a complete, verified install
```

Installation is idempotent. A partial directory is deleted and re-extracted, and the completion
marker is written last, so an interrupted install can never be mistaken for a finished one. A digest
mismatch deletes the temporary file and aborts, so a file that failed verification is never renamed
into place and never made executable.

### Digest pinning

Every shipped file's real SHA-256 is hard-coded in `TerminalRuntime.java` and re-checked in
`verifyTerminalApk`. Nothing is relaxed or skipped.

| File | SHA-256 |
| --- | --- |
| `proot` | `98a5f86aad8d7f91e36ee039c64c8f5ac20738e545c883c559bf93e9b94e7bfa` |
| `libtalloc.so.2` | `3c9b207c0a6ea2896b7523e03f55d9ab0d9e88baa115d4c32b84058ff4246fbb` |
| `libandroid-shmem.so` | `84475798e07c8174dbbfaec70a827fdb02f19ffa69a589380c13e7507fd0e731` |
| rootfs, as shipped (`.tar`) | `f2e4118020b2e713aaf37a48e1d6ac65b9c79f4e370e366495025df8f98df944` |
| rootfs, upstream (`.tar.gz`) | `f25a96d2846a4bc439093107c1b48a8b0c93dcb411e2cb9cfded6f790b2bc001` |

## Security

* The shell runs with a **cleared environment**. Only `PATH`, `HOME`, `TERM`, `TMPDIR` and
  `LD_LIBRARY_PATH` are set. The loopback secret, API keys, Stytch and Render credentials cannot
  reach the shell, and `env` inside it will not show them.
* The WebView cannot pass a filesystem path. The only thing it can influence is a session id, which
  is validated against `^[0-9a-f]{32}$` and is a lookup key, not authorisation.
* Authorisation is the existing `kairema_loopback` cookie, checked by `LoopbackHttpCore` before any
  local handler runs. There is no second secret mechanism, and the secret never appears in a URL.
  The listener is bound to `127.0.0.1` on an ephemeral port, so no other app can connect at all.
* No `MANAGE_EXTERNAL_STORAGE`, no root, no background service, no Accessibility service, no
  Shizuku. `verifyTerminalApk` fails the build if any of those permissions appear.
* The safe tar reader refuses absolute paths, `..`, drive-qualified paths, device nodes, FIFOs, hard
  links and unsupported entry types, and bounds per-entry and total size.
* Absolute symlink targets are **allowed**, because the shipped rootfs has 306 of them pointing at
  `/bin/busybox`. That is safe here precisely because proot re-roots guest absolute paths into the
  guest root, so `/system` and other apps' files are not reachable. A *relative* symlink that escapes
  on the host filesystem is still refused.
* Commands, stdin, stdout, stderr and the environment are never logged. Log lines carry a route
  prefix and a lifecycle state only.

## API

All under `/api/local/terminal`, which is deliberately **not** in the proxy allowlist. The backend
has no terminal, so a request that reached it would be answered by the wrong server, and the
allowlist stays exactly its original six entries. `LoopbackRoutes.localPrefixesOverlapProxyAllowlist()`
asserts the two sets do not overlap.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/local/terminal/session` | create a session, returns `{id, cwd}` |
| `POST` | `/api/local/terminal/{id}/input` | write stdin, body `{"data":"..."}` |
| `GET` | `/api/local/terminal/{id}/stream` | stream NDJSON |
| `POST` | `/api/local/terminal/{id}/kill` | stop a session |
| `GET` | `/api/local/terminal/status` | live session count and readiness |

Errors are stable tokens only (`session_limit`, `runtime_unavailable`, `no_such_session`,
`input_too_large`, `malformed_body`, `output_truncated`). No exception message, path or digest is
ever returned, so a failure cannot describe the private directory layout to the page.

### Stream format

One JSON object per line, flushed per frame:

```json
{"type":"stdout","data":"/home/kairema\n"}
{"type":"stderr","data":"sh: nope: not found\n"}
{"type":"keepalive"}
{"type":"exit","code":127}
```

A keepalive is written every 10 s of silence so the WebView does not treat an idle shell as a stalled
connection. Output is drained into a bounded queue; when it saturates the readers stop reading, the
pipe fills and the child blocks, so a runaway command slows the shell rather than exhausting memory.
If frames are still dropped, the client is told `output_truncated` explicitly — output is never lost
silently.

Session ids are 128 bits of `SecureRandom` as 32 lowercase hex characters. At most 4 sessions; the
cap is enforced under one lock, and expired sessions are reaped first. A session has a 30 minute
maximum lifetime. `MainActivity.onDestroy` stops every session so no proot process is orphaned.

## UI

`client/src/pages/Terminal.tsx`, routed at `/terminal`. The sidebar entry is rendered only when
`Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android"`, so the terminal does not
appear on the web site at all.

Output is rendered as React text nodes. `dangerouslySetInnerHTML` is not used anywhere on this
screen, so terminal output is escaped by construction rather than by a filter that might miss a
case. stdout, stderr and the exit status are visually distinct. `client/src/lib/terminal-client.ts`
reassembles NDJSON across arbitrary chunk boundaries, which is tested directly.

## Verifying a build

```bash
pnpm android:build      # build:android:web && cap sync android && gradlew assembleDebug
pnpm android:verify-apk # inspects the built APK
```

`scripts/verify-terminal-apk.mjs` reads the real assembled APK and checks the ABI, the presence and
digests of every native file, the rootfs asset and its digest, 16 KB ELF alignment, AArch64 and PIE
type, `extractNativeLibs=true`, and the absence of forbidden permissions. It exits non-zero on any
failure so it can gate a build.

It proves **packaging only**. It cannot prove that proot runs.

## Known limitations of this MVP

* `arm64-v8a` only.
* A first-run installation extracts roughly 60 MB of rootfs, which takes a few seconds; the routes
  report `runtime_unavailable` until it completes.
* No `apk` package installation, so the rootfs is fixed at the shipped Alpine 3.21.8.
* Commands, stdout and stderr are not persisted across app restarts.

## Distribution blocker

Shipping an APK that bundles proot, talloc and Alpine requires the full licence and notice texts for
those components to accompany the distribution. `THIRD-PARTY-NOTICES.txt` records the provenance and
the licences as stated by the upstream projects, but it is **not** a substitute for a legal review, and
whether these notices are sufficient for a given distribution is a question for whoever owns
distribution. That judgement is deliberately not made here.
