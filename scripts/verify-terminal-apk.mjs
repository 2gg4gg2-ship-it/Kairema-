#!/usr/bin/env node
/**
 * Verifies the built APK actually contains a runnable on-device terminal.
 *
 * This reads the real, assembled APK. It deliberately does not check the source tree: the whole
 * point is to catch the packaging faults that only appear at packaging time, and two of the three
 * original blockers were invisible until `unzip -l` was run against the finished file.
 *
 *   1. only arm64-v8a is present
 *   2. proot, its loader, libtalloc.so.2 and libandroid-shmem.so are all in the APK
 *   3. the Alpine rootfs asset is present under a name the runtime knows
 *   4. the native files' SHA-256 match the digests pinned in TerminalRuntime.java
 *   5. extractNativeLibs=true, without which proot cannot be exec()ed
 *   6. the ELF binaries are arm64 and 16 KB page aligned, as API 35+ requires
 *   7. no manifest permission that would widen the app's reach
 *
 * Usage: node scripts/verify-terminal-apk.mjs [path-to-apk]
 * Exits non-zero and prints every failure, so it can gate a build.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const DEFAULT_APK = join(repoRoot, "android/app/build/outputs/apk/debug/app-debug.apk");
const apkPath = resolve(process.argv[2] ?? DEFAULT_APK);

/** Mirrors TerminalRuntime.java. Kept in step with it by the digest checks below. */
const EXPECTED_DIGESTS = {
  "assets/terminal/native/arm64-v8a/proot":
    "98a5f86aad8d7f91e36ee039c64c8f5ac20738e545c883c559bf93e9b94e7bfa",
  "assets/terminal/native/arm64-v8a/libtalloc.so.2":
    "3c9b207c0a6ea2896b7523e03f55d9ab0d9e88baa115d4c32b84058ff4246fbb",
  "lib/arm64-v8a/libandroid-shmem.so":
    "84475798e07c8174dbbfaec70a827fdb02f19ffa69a589380c13e7507fd0e731",
  "lib/arm64-v8a/libprootloader.so":
    "cbdef0e652c2b78af25d867e1719fdebbb0915e25aae2dd35b3b5c1835f6b551",
};

/** The two forms the rootfs may take, with the digest of each. */
const ROOTFS_DIGESTS = {
  "assets/terminal/rootfs/alpine-minirootfs-3.21.8-aarch64.tar.gz":
    "f25a96d2846a4bc439093107c1b48a8b0c93dcb411e2cb9cfded6f790b2bc001",
  "assets/terminal/rootfs/alpine-minirootfs-3.21.8-aarch64.tar":
    "f2e4118020b2e713aaf37a48e1d6ac65b9c79f4e370e366495025df8f98df944",
};

const failures = [];
const notes = [];
const fail = (message) => failures.push(message);
const note = (message) => notes.push(message);

if (!existsSync(apkPath)) {
  console.error(`verify-terminal-apk: no APK at ${apkPath}`);
  console.error("Build it first:  cd android && ./gradlew assembleDebug");
  process.exit(2);
}

const apkBytes = readFileSync(apkPath);
const apkSize = apkBytes.length;

// ---------------------------------------------------------------- entry listing

let listing;
try {
  listing = execFileSync("unzip", ["-l", apkPath], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
} catch (error) {
  console.error("verify-terminal-apk: could not list the APK with unzip:", error.message);
  process.exit(2);
}

const entries = new Map();
for (const line of listing.split("\n")) {
  // "  <size> <date> <time>   <name>"
  const match = line.match(/^\s*(\d+)\s+\S+\s+\S+\s+(\S.*)$/);
  if (match && match[1] !== "Length") {
    entries.set(match[2].trim(), Number(match[1]));
  }
}
note(`APK entries listed: ${entries.size}`);

// ---------------------------------------------------------------- 1. ABI

const libEntries = [...entries.keys()].filter((name) => name.startsWith("lib/"));
const abis = new Set(libEntries.map((name) => name.split("/")[1]).filter(Boolean));
if (abis.size === 0) {
  fail("no native libraries at all: lib/ is empty");
}
for (const abi of abis) {
  if (abi !== "arm64-v8a") {
    fail(`unexpected ABI in the APK: ${abi} (only arm64-v8a is built)`);
  }
}
if (!abis.has("arm64-v8a")) {
  fail("arm64-v8a is missing from lib/");
}
note(`ABIs: ${[...abis].join(", ")}`);

// ---------------------------------------------------------------- 2 & 4. required binaries

for (const [path, digest] of Object.entries(EXPECTED_DIGESTS)) {
  if (!entries.has(path)) {
    fail(`required native file is missing from the APK: ${path}`);
  }
}
const foundProot = Object.keys(EXPECTED_DIGESTS).find((p) => p.endsWith("/proot") && entries.has(p));
if (!foundProot) {
  fail(
    "proot is not in the APK. AGP only packages jniLibs entries whose name ends in .so, and " +
      "\"proot\" has no extension, so it must ship as an asset and be staged at runtime.",
  );
}
// The loader is pinned under lib/ above, not as an asset, and that placement is load-bearing rather
// than incidental: proot exec()s it, and since API 29 an app may not exec a file from its own data
// directory, so an asset copy staged at runtime could never be started. See TerminalRuntime.

// ---------------------------------------------------------------- 3. rootfs

const presentRootfs = Object.keys(ROOTFS_DIGESTS).filter((path) => entries.has(path));
if (presentRootfs.length === 0) {
  fail(
    "the Alpine rootfs is missing under every name the runtime looks for: " +
      Object.keys(ROOTFS_DIGESTS).join(", "),
  );
}
if (presentRootfs.length > 1) {
  note(`both rootfs spellings are present (${presentRootfs.length}); the runtime tries .tar.gz first`);
}
note(`rootfs asset: ${presentRootfs[0] ?? "(none)"}`);

// ---------------------------------------------------------------- extraction for verification

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
{
  /** The exact bytes of one APK entry, so a digest is measured on what actually ships. */
  const entryBytes = (path) =>
    execFileSync("unzip", ["-p", apkPath, path], { maxBuffer: 256 * 1024 * 1024 });

  for (const [path, expected] of Object.entries(EXPECTED_DIGESTS)) {
    if (!entries.has(path)) continue;
    const actual = sha256(entryBytes(path));
    if (actual !== expected) {
      fail(`digest mismatch for ${path}\n    expected ${expected}\n    actual   ${actual}`);
    } else {
      note(`digest ok: ${path}`);
    }
  }

  for (const path of presentRootfs) {
    const actual = sha256(entryBytes(path));
    if (actual !== ROOTFS_DIGESTS[path]) {
      fail(
        `rootfs digest mismatch for ${path}\n    expected ${ROOTFS_DIGESTS[path]}\n    actual   ${actual}`,
      );
    } else {
      note(`digest ok: ${path}`);
    }
  }

  // ---------------------------------------------------------------- 6. ELF sanity

  for (const path of Object.keys(EXPECTED_DIGESTS)) {
    if (!entries.has(path)) continue;
    const buffer = entryBytes(path);
    // Not every required entry is an ELF (this loop covers the native ones only, but be explicit).
    if (buffer.length < 64 || buffer.readUInt32BE(0) !== 0x7f454c46) {
      fail(`${path} is not an ELF file`);
      continue;
    }
    const machine = buffer.readUInt16LE(18);
    if (machine !== 0xb7) {
      fail(`${path} is not AArch64 (e_machine=0x${machine.toString(16)})`);
    }
    const elfType = buffer.readUInt16LE(16);
    if ((elfType & 0x0002) === 0) {
      fail(`${path} has e_type=${elfType}, which Android cannot load or execute`);
    }
    // Walk the program headers for a PT_LOAD alignment of at least 16 KB, which is what an
    // API 35+ device with 16 KB pages requires.
    const phoff = Number(buffer.readBigUInt64LE(32));
    const phentsize = buffer.readUInt16LE(54);
    const phnum = buffer.readUInt16LE(56);
    let minAlign = Infinity;
    for (let i = 0; i < phnum; i++) {
      const base = phoff + i * phentsize;
      if (base + 56 > buffer.length) break;
      if (buffer.readUInt32LE(base) !== 1) continue; // PT_LOAD
      const pAlign = Number(buffer.readBigUInt64LE(base + 48));
      if (pAlign > 0 && pAlign < minAlign) minAlign = pAlign;
    }
    if (minAlign === Infinity) {
      fail(`${path} has no PT_LOAD segment`);
    } else if (minAlign < 16384) {
      fail(
        `${path} has a PT_LOAD alignment of ${minAlign}, below the 16 KB required on API 35+ ` +
          "devices; it would fail to load there",
      );
    } else {
      note(`16 KB aligned: ${path} (align=${minAlign})`);
    }
  }
}

// ---------------------------------------------------------------- 5 & 7. manifest

const aapt2 = findAapt2();
if (!aapt2) {
  fail(
    "aapt2 was not found, so extractNativeLibs could not be checked. Set ANDROID_HOME or " +
      "ANDROID_SDK_ROOT, or install build-tools.",
  );
} else {
  let xml = "";
  try {
    xml = execFileSync(aapt2, ["dump", "xmltree", "--file", "AndroidManifest.xml", apkPath], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    fail(`aapt2 could not read the packaged manifest: ${error.message}`);
  }
  if (xml) {
    // proot is exec()ed. With extractNativeLibs=false the binary only exists inside the APK and
    // cannot be executed, so this flag is a hard requirement rather than a preference.
    const match = xml.match(/extractNativeLibs\(0x[0-9a-f]+\)\s*=\s*(\w+)/i);
    if (!match) {
      fail(
        "extractNativeLibs is not set in the packaged manifest. proot must be exec()'d, which " +
          "requires the platform to extract lib/ to nativeLibraryDir. Set " +
          "packaging { jniLibs { useLegacyPackaging true } }.",
      );
    } else if (match[1] !== "true") {
      fail(`extractNativeLibs=${match[1]}, but proot cannot be executed unless it is true`);
    } else {
      note("extractNativeLibs=true (native libraries are extracted and executable)");
    }

    const forbidden = [
      "MANAGE_EXTERNAL_STORAGE",
      "READ_EXTERNAL_STORAGE",
      "WRITE_EXTERNAL_STORAGE",
      "REQUEST_INSTALL_PACKAGES",
      "QUERY_ALL_PACKAGES",
    ];
    for (const permission of forbidden) {
      if (xml.includes(`"android.permission.${permission}"`)) {
        fail(`the manifest requests ${permission}, which the terminal MVP must not need`);
      }
    }
    if (xml.includes('"android.permission.INTERNET"') === false) {
      note("no INTERNET permission (expected: the shell is local)");
    }
  }
}

function findAapt2() {
  const candidates = [];
  const sdk =
    process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? readSdkDirFromLocalProperties();
  if (sdk) {
    const buildToolsRoot = join(sdk, "build-tools");
    if (existsSync(buildToolsRoot)) {
      for (const version of listDirs(buildToolsRoot).sort().reverse()) {
        candidates.push(join(buildToolsRoot, version, "aapt2"));
      }
    }
  }
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function readSdkDirFromLocalProperties() {
  const file = join(repoRoot, "android/local.properties");
  if (!existsSync(file)) return null;
  const match = readFileSync(file, "utf8").match(/^sdk\.dir=(.+)$/m);
  return match ? match[1].trim() : null;
}

function listDirs(directory) {
  try {
    return execFileSync("ls", ["-1", directory], { encoding: "utf8" })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- report

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
console.log("verify-terminal-apk");
console.log(`  apk        ${apkPath}`);
console.log(`  size       ${apkBytes.length} bytes (${mb(apkBytes.length)})`);
for (const message of notes) console.log(`  - ${message}`);
for (const [path, size] of [...entries.entries()].filter(([name]) =>
  name.startsWith("lib/") || name.includes("terminal/"),
)) {
  console.log(`  entry      ${path} (${size} bytes)`);
}

if (failures.length > 0) {
  console.error("");
  for (const message of failures) console.error(`  FAIL: ${message}`);
  console.error("");
  console.error(`verify-terminal-apk: ${failures.length} problem(s) found.`);
  process.exit(1);
}

console.log("");
console.log("verify-terminal-apk: all checks passed.");
console.log("Note: this proves packaging only. proot execution is unverified without a device.");
