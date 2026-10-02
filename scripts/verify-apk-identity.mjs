#!/usr/bin/env node
/**
 * Verifies that a built debug APK is a legitimate successor of the one already on the phone.
 *
 * Android allows an APK to replace an installed one only when two facts hold: the applicationId is
 * byte-for-byte identical, and versionCode is strictly greater. It additionally refuses any update
 * whose signing certificate differs from the installed app, with INSTALL_FAILED_UPDATE_INCOMPATIBLE.
 * All three are invisible in the source tree and only appear in the finished, signed file, which is
 * why this reads the APK rather than the Gradle configuration.
 *
 * Checks:
 *   1. applicationId is the expected one and has not drifted
 *   2. versionCode is a real integer, above the floor, and higher than any compared predecessor
 *   3. versionName is set and non-empty
 *   4. the APK is signed, and its certificate SHA-256 matches the expected one when given
 *   5. with --compare, the predecessor's applicationId and certificate match, and its versionCode
 *      is strictly lower: i.e. this APK *could* be installed over it without uninstalling
 *
 * Terminal asset and digest checks live in verify-terminal-apk.mjs, which the workflow runs
 * alongside this one.
 *
 * Usage:
 *   node scripts/verify-apk-identity.mjs [apk] [--expect-cert <sha256>] [--compare <older-apk>]
 *
 * Exits non-zero and prints every failure, so it can gate a build.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const DEFAULT_APK = join(repoRoot, "android/app/build/outputs/apk/debug/app-debug.apk");

/** The published applicationId. Changing it forks the app and orphans every install. */
const EXPECTED_APPLICATION_ID = "im.kairema.app";

/**
 * versionCode 1 was the hardcoded value that made every build look like the same release, so no
 * build could ever replace another. A real update must be above it.
 */
const MIN_VERSION_CODE = 2;

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
};
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));

const apkPath = resolve(positional[0] ?? DEFAULT_APK);
const expectCert = (flag("--expect-cert") ?? process.env.KAIREMA_ANDROID_DEBUG_CERT_SHA256 ?? "")
  .replace(/[^0-9a-f]/gi, "")
  .toLowerCase();
const comparePath = flag("--compare") ? resolve(flag("--compare")) : null;

const failures = [];
const notes = [];
const fail = (m) => failures.push(m);
const note = (m) => notes.push(m);

if (!existsSync(apkPath)) {
  console.error(`verify-apk-identity: no APK at ${apkPath}`);
  console.error("Build it first:  cd android && ./gradlew assembleDebug");
  process.exit(2);
}

// ---------------------------------------------------------------- tool discovery

function sdkRoot() {
  return (
    process.env.ANDROID_HOME ??
    process.env.ANDROID_SDK_ROOT ??
    (() => {
      const file = join(repoRoot, "android/local.properties");
      if (!existsSync(file)) return null;
      const m = readFileSync(file, "utf8").match(/^sdk\.dir=(.+)$/m);
      return m ? m[1].trim() : null;
    })()
  );
}

function listDirs(dir) {
  try {
    return execFileSync("ls", ["-1", dir], { encoding: "utf8" })
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function findTool(name) {
  const sdk = sdkRoot();
  if (!sdk) return null;
  const root = join(sdk, "build-tools");
  if (!existsSync(root)) return null;
  for (const version of listDirs(root).sort().reverse()) {
    const candidate = join(root, version, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const aapt2 = findTool("aapt2");
const apksigner = findTool("apksigner");
if (!aapt2) {
  console.error("verify-apk-identity: aapt2 not found. Set ANDROID_HOME or ANDROID_SDK_ROOT.");
  process.exit(2);
}
if (!apksigner) {
  console.error("verify-apk-identity: apksigner not found. Set ANDROID_HOME or ANDROID_SDK_ROOT.");
  process.exit(2);
}

// ---------------------------------------------------------------- readers

/** The facts Android itself reads when deciding whether an update is admissible. */
function readIdentity(path) {
  let badging;
  try {
    badging = execFileSync(aapt2, ["dump", "badging", path], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    fail(`aapt2 could not read ${path}: ${error.message}`);
    return null;
  }
  const pkg = badging.match(/^package:\s+name='([^']+)'\s+versionCode='([^']*)'\s+versionName='([^']*)'/m);
  if (!pkg) {
    fail(`could not parse package identity out of ${path}`);
    return null;
  }
  return { applicationId: pkg[1], versionCode: pkg[2], versionName: pkg[3] };
}

function readCert(path) {
  let out;
  try {
    out = execFileSync(apksigner, ["verify", "--print-certs", path], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    // apksigner exits non-zero for a valid-but-unsigned APK too, so parse whatever it printed.
    out = `${error.stdout ?? ""}`;
    if (!/certificate SHA-256 digest/i.test(out)) {
      fail(`${path} is not signed, or apksigner could not verify it: ${error.message}`);
      return null;
    }
  }
  const sha256 = out.match(/Signer #1 certificate SHA-256 digest:\s*([0-9a-fA-F]+)/i);
  const dn = out.match(/Signer #1 certificate DN:\s*(.+)/i);
  const all = [...out.matchAll(/Signer #\d+ certificate SHA-256 digest:\s*([0-9a-fA-F]+)/gi)];
  if (!sha256) {
    fail(`could not read a signing certificate SHA-256 from ${path}`);
    return null;
  }
  return {
    sha256: sha256[1].toLowerCase(),
    dn: dn ? dn[1].trim() : "(unknown)",
    // A second signer means the APK is signed by more than one identity, which is a red flag for
    // a debug build and makes "the" fingerprint ambiguous.
    signers: all.length,
  };
}

// ---------------------------------------------------------------- current APK

const identity = readIdentity(apkPath);
const cert = readCert(apkPath);

if (identity) {
  if (identity.applicationId !== EXPECTED_APPLICATION_ID) {
    fail(
      `applicationId is '${identity.applicationId}', expected '${EXPECTED_APPLICATION_ID}'. ` +
        "Changing it forks the app: the new one installs alongside the old instead of replacing it.",
    );
  } else {
    note(`applicationId ok: ${identity.applicationId}`);
  }

  if (!/^\d+$/.test(identity.versionCode)) {
    fail(`versionCode '${identity.versionCode}' is not an integer`);
  } else {
    const code = Number(identity.versionCode);
    if (code < MIN_VERSION_CODE) {
      fail(
        `versionCode is ${code}, which is not above the previous hardcoded ${MIN_VERSION_CODE - 1}. ` +
          "Android only installs an update whose versionCode is strictly greater, so this APK " +
          "would be refused over the previously installed one.",
      );
    } else {
      note(`versionCode ok: ${code}`);
    }
  }

  if (!identity.versionName || identity.versionName.trim() === "") {
    fail("versionName is empty; it should identify the build to a human reading the phone");
  } else {
    note(`versionName ok: ${identity.versionName}`);
  }
}

if (cert) {
  if (cert.signers > 1) {
    fail(`the APK carries ${cert.signers} signers; a debug build must have exactly one`);
  }
  if (expectCert) {
    if (cert.sha256 !== expectCert) {
      fail(
        "signing certificate does not match the expected fingerprint, so this APK cannot " +
          "replace one built earlier.\n" +
          `    expected ${expectCert}\n    actual   ${cert.sha256}\n` +
          "  The keystore is drifting. If the secrets were rotated, every phone must uninstall " +
          "once; if they were not, the wrong keystore is being picked up.",
      );
    } else {
      note(`signing certificate matches the expected fingerprint: ${cert.sha256}`);
    }
  }
  note(`signer DN: ${cert.dn}`);
}

// ---------------------------------------------------------------- upgrade comparison

if (comparePath) {
  if (!existsSync(comparePath)) {
    fail(`--compare was given ${comparePath}, which does not exist`);
  } else {
    const older = readIdentity(comparePath);
    const olderCert = readCert(comparePath);
    if (older && identity) {
      if (older.applicationId !== identity.applicationId) {
        fail(
          `the predecessor has applicationId '${older.applicationId}' but this APK has ` +
            `'${identity.applicationId}'. An APK with a different applicationId installs as a ` +
            "separate app and leaves the old one in place.",
        );
      } else if (Number(identity.versionCode) <= Number(older.versionCode)) {
        fail(
          `versionCode ${identity.versionCode} is not greater than the predecessor's ` +
            `${older.versionCode}; Android would refuse this update as the same or an older version.`,
        );
      } else {
        note(
          `upgrade path ok: ${older.applicationId} versionCode ${older.versionCode} ` +
            `-> ${identity.versionCode}`,
        );
      }
    }
    if (olderCert && cert && olderCert.sha256 !== cert.sha256) {
      fail(
        "the two APKs are signed by different certificates, so Android will refuse the update " +
          "with INSTALL_FAILED_UPDATE_INCOMPATIBLE even though the versionCode is higher.\n" +
          `    predecessor ${olderCert.sha256}\n    current     ${cert.sha256}`,
      );
    } else if (olderCert && cert) {
      note(`both APKs share signing certificate ${cert.sha256}`);
    }
  }
}

// ---------------------------------------------------------------- report

console.log("verify-apk-identity");
console.log(`  apk             ${apkPath}`);
if (identity) {
  console.log(`  applicationId   ${identity.applicationId}`);
  console.log(`  versionCode     ${identity.versionCode}`);
  console.log(`  versionName     ${identity.versionName}`);
}
if (cert) {
  console.log(`  cert SHA-256    ${cert.sha256}`);
}
if (comparePath) console.log(`  compared with   ${comparePath}`);
for (const message of notes) console.log(`  - ${message}`);

if (failures.length > 0) {
  console.error("");
  for (const message of failures) console.error(`  FAIL: ${message}`);
  console.error("");
  console.error(`verify-apk-identity: ${failures.length} problem(s) found.`);
  process.exit(1);
}

console.log("");
console.log("verify-apk-identity: all checks passed.");
if (!comparePath) {
  console.log(
    "Note: this proves the APK's own identity. Whether it replaces the *installed* app is only " +
      "fully shown by installing it, or by --compare against the APK that is installed.",
  );
}
