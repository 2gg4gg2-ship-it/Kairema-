// Loopback payload check.
//
// Answers one question with evidence instead of assumptions: does the Android WebView path
// (WebView -> LoopbackHttpCore -> upstream) hand the backend the exact bytes the browser path
// (browser -> upstream) does?
//
// It builds the request with the project's own @trpc/client + superjson, so the wire format is the
// real one, then sends the identical raw bytes twice: once straight to a local upstream and once
// through the real LoopbackHttpCore, and compares what the upstream received.
//
// No credential is ever printed. Bodies are only ever reported as a byte count, a truncated SHA-256
// and the presence of the expected JSON fields.
//
// Requirements: Node (already required by the repo) and a JDK 21 on JAVA_HOME or PATH. The Android
// CI workflow installs JDK 21, so the same command runs there.
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const loopbackSources = path.join(repoRoot, "android/app/src/main/java/im/kairema/app/loopback");

const sha = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
let failures = 0;

function check(name, condition, detail) {
  if (condition) {
    console.log(`  PASS ${name}`);
    return;
  }
  failures++;
  console.log(`  FAIL ${name}${detail ? ` (${detail})` : ""}`);
}

function resolveJdk() {
  if (process.env.JAVA_HOME && fs.existsSync(path.join(process.env.JAVA_HOME, "bin", "javac"))) {
    return process.env.JAVA_HOME;
  }
  const which = spawnSync("which", ["javac"], { encoding: "utf8" });
  if (which.error || which.status !== 0) return null;
  return path.resolve(path.dirname(which.stdout.trim()), "..");
}

function javaBin(jdk, tool) {
  return jdk ? path.join(jdk, "bin", tool) : tool;
}

function buildCore(jdk) {
  const build = fs.mkdtempSync(path.join(os.tmpdir(), "kairema-loopback-check-"));
  const packageDir = path.join(build, "src", "im", "kairema", "app", "loopback");
  fs.mkdirSync(packageDir, { recursive: true });
  for (const file of ["LoopbackHttpCore.java", "LoopbackLog.java", "LoopbackRoutes.java", "LoopbackServer.java", "LoopbackStaticSource.java"]) {
    fs.copyFileSync(path.join(loopbackSources, file), path.join(packageDir, file));
  }
  const driverDir = path.join(build, "src", "im", "kairema", "app", "loopback", "payloadcheck");
  fs.mkdirSync(driverDir, { recursive: true });
  fs.copyFileSync(path.join(here, "loopback-payload-check", "LoopbackDriver.java"), path.join(driverDir, "LoopbackDriver.java"));

  const sources = fs
    .readdirSync(path.join(build, "src", "im", "kairema", "app", "loopback"))
    .filter((name) => name.endsWith(".java"))
    .map((name) => path.join(build, "src", "im", "kairema", "app", "loopback", name));
  sources.push(path.join(driverDir, "LoopbackDriver.java"));

  const out = path.join(build, "out");
  fs.mkdirSync(out, { recursive: true });
  const compiled = spawnSync(javaBin(jdk, "javac"), ["-d", out, ...sources], { encoding: "utf8" });
  if (compiled.status !== 0) {
    throw new Error(`javac failed:\n${compiled.stderr || compiled.stdout}`);
  }
  return out;
}

// ---------------------------------------------------------------- upstream recorder

const records = [];
let nextResponse = { status: 200, headers: {}, body: null };

const upstream = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    records.push({
      method: req.method,
      url: req.url,
      contentType: req.headers["content-type"] ?? null,
      contentLengthHeader: req.headers["content-length"] ?? null,
      transferEncoding: req.headers["transfer-encoding"] ?? null,
      body: Buffer.concat(chunks),
    });
    const body = nextResponse.body ?? JSON.stringify([{ result: { data: { json: { state: "OTP_REQUIRED" } } } }]);
    res.writeHead(nextResponse.status, { "Content-Type": "application/json", ...nextResponse.headers });
    res.end(body);
  });
});

function exchange(port, rawText) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    const parts = [];
    socket.on("connect", () => socket.write(Buffer.from(rawText, "latin1")));
    socket.on("data", (data) => parts.push(data));
    const finish = () => resolve(Buffer.concat(parts).toString("latin1"));
    socket.on("end", finish);
    socket.on("close", finish);
    socket.on("error", reject);
    socket.setTimeout(20000, () => reject(new Error("timeout")));
  });
}

function buildRawRequest({ method, path, headers, body, chunked }) {
  const merged = { Host: "127.0.0.1", Connection: "keep-alive", ...headers };
  const order = ["Host", "Connection", "User-Agent", "Accept", "Origin", "Referer", "Cookie", "Content-Type", "Transfer-Encoding", "Content-Length"];
  const lines = [`${method} ${path} HTTP/1.1`];
  for (const name of order) if (merged[name] !== undefined) lines.push(`${name}: ${merged[name]}`);
  for (const name of Object.keys(merged)) if (!order.includes(name)) lines.push(`${name}: ${merged[name]}`);
  const head = `${lines.join("\r\n")}\r\n\r\n`;
  if (!chunked) return head + body.toString("latin1");

  const half = Math.floor(body.length / 2);
  return `${head}${half.toString(16)}\r\n${body.subarray(0, half).toString("latin1")}\r\n${(body.length - half).toString(16)}\r\n${body.subarray(half).toString("latin1")}\r\n0\r\n\r\n`;
}

// ---------------------------------------------------------------- the real tRPC request

async function captureTrpcRequest(input) {
  let captured = null;
  const client = createTRPCProxyClient({
    links: [
      httpBatchLink({
        url: "http://127.0.0.1:59999/api/trpc",
        transformer: superjson,
        headers() {
          return {};
        },
        async fetch(request, init) {
          captured = { url: String(request), init: { ...(init ?? {}) } };
          return new Response(JSON.stringify([{ result: { data: { json: { state: "OTP_REQUIRED" } } } }]), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      }),
    ],
  });
  await client.auth.stytch.login.mutate(input);
  return captured;
}

function describe(label, record) {
  const presence = (() => {
    try {
      const parsed = JSON.parse(record.body.toString("utf8"));
      const keys = Object.keys(parsed ?? {});
      const entry = Array.isArray(parsed) ? parsed[0] : (keys.length === 1 ? parsed[keys[0]] : parsed);
      const inner = entry && typeof entry === "object" ? (entry.json ?? entry) : null;
      return {
        parsed: true,
        emailPresent: typeof inner?.email === "string" && inner.email.length > 0,
        passwordPresent: typeof inner?.password === "string" && inner.password.length > 0,
        batchKeys: keys,
      };
    } catch {
      return { parsed: false, emailPresent: false, passwordPresent: false, batchKeys: [] };
    }
  })();
  return [
    `  ${label}`,
    `    ${record.method} ${record.url}`,
    `    contentType=${record.contentType ?? "(absent)"} contentLength=${record.contentLengthHeader ?? "(absent)"} transferEncoding=${record.transferEncoding ?? "(absent)"}`,
    `    bodyBytes=${record.body.length} sha=${sha(record.body)} jsonParsed=${presence.parsed} emailPresent=${presence.emailPresent} passwordPresent=${presence.passwordPresent} batchKeys=${JSON.stringify(presence.batchKeys)}`,
  ].join("\n");
}

const SCENARIOS = [
  { name: "plain ascii credentials", input: { email: "diag@example.com", password: "diag-password-123" } },
  { name: "non-ascii password (Cyrillic, emoji, combining mark)", input: { email: "юзер@example.com", password: "Пароль-ё-🔐-é" } },
  { name: "JSON and percent hostile password", input: { email: "a+b@example.com", password: 'q"uote\\back&eq=%3F+plus space\ttab' } },
  { name: "200 KiB body", input: { email: "big@example.com", password: "x".repeat(200 * 1024) } },
];

async function main() {
  const jdk = resolveJdk();
  if (!jdk) {
    console.error("no JDK 21 found: set JAVA_HOME to a JDK 21 installation");
    process.exit(2);
  }
  const classpath = buildCore(jdk);

  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamPort = upstream.address().port;

  const driver = spawn(javaBin(jdk, "java"), ["-cp", classpath, "im.kairema.app.loopback.payloadcheck.LoopbackDriver", String(upstreamPort)], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  let banner = "";
  await new Promise((resolve, reject) => {
    driver.stdout.on("data", (data) => {
      banner += data.toString();
      if (banner.includes("COOKIE=")) resolve();
    });
    driver.on("error", reject);
    setTimeout(() => reject(new Error("loopback driver did not start")), 30000);
  });
  const loopbackPort = Number(/PORT=(\d+)/.exec(banner)[1]);
  const accessCookie = /COOKIE=(.+)/.exec(banner)[1].trim().split(";")[0];
  console.log(`upstream 127.0.0.1:${upstreamPort}, loopback 127.0.0.1:${loopbackPort}\n`);

  for (const scenario of SCENARIOS) {
    const captured = await captureTrpcRequest(scenario.input);
    const url = new URL(captured.url);
    const body = Buffer.from(captured.init.body ?? "", "utf8");
    const clientHeaders = captured.init.headers ?? {};
    const pathAndQuery = url.pathname + url.search;

    console.log(`### ${scenario.name}`);
    console.log(`  client sends: ${captured.init.method} ${url.pathname}?${url.search.split("=")[0]}=... (input omitted)`);
    console.log(`  client headers: ${JSON.stringify(Object.keys(clientHeaders))}, body ${body.length} bytes`);
    if (scenario === SCENARIOS[0]) {
      console.log(`  body shape: ${body.toString("utf8").replace(/"email":"[^"]*"/, '"email":"<redacted>"').replace(/"password":"[^"]*"/, '"password":"<redacted>"')}`);
    }

    for (const chunked of [false, true]) {
      const framing = chunked ? { "Transfer-Encoding": "chunked" } : { "Content-Length": String(body.length) };
      const beforeWeb = records.length;
      await exchange(upstreamPort, buildRawRequest({ method: captured.init.method, path: pathAndQuery, headers: { ...clientHeaders, ...framing }, body, chunked }));
      const web = records[beforeWeb];

      const beforeAndroid = records.length;
      await exchange(loopbackPort, buildRawRequest({ method: captured.init.method, path: pathAndQuery, headers: { ...clientHeaders, Cookie: accessCookie, ...framing }, body, chunked }));
      const android = records[beforeAndroid];

      const tag = chunked ? "chunked" : "content-length";
      console.log(`  [${tag}]`);
      console.log(describe("upstream via WEB     (browser -> upstream)", web));
      console.log(describe("upstream via ANDROID (WebView -> loopback -> upstream)", android));
      check(`[${tag}] body bytes identical`, web.body.equals(android.body), `web=${sha(web.body)} android=${sha(android.body)}`);
      check(`[${tag}] body length matches what the client sent`, android.body.length === body.length, `got=${android.body.length} want=${body.length}`);
      check(`[${tag}] method, path and query identical`, web.method === android.method && web.url === android.url);
      check(`[${tag}] content-type preserved`, web.contentType === android.contentType, `web=${web.contentType} android=${android.contentType}`);
    }
    console.log("");
  }

  console.log("### response integrity through the loopback");
  const captured = await captureTrpcRequest(SCENARIOS[0].input);
  const url = new URL(captured.url);
  const body = Buffer.from(captured.init.body ?? "", "utf8");
  const send = () => exchange(loopbackPort, buildRawRequest({
    method: "POST",
    path: url.pathname + url.search,
    headers: { "content-type": "application/json", Cookie: accessCookie, "Content-Length": String(body.length) },
    body,
  }));

  nextResponse = {
    status: 200,
    headers: { "Set-Cookie": ["__Host-a=1; Path=/; Secure; HttpOnly; SameSite=None", "__Host-b=2; Path=/; Secure; HttpOnly; SameSite=None"] },
  };
  const ok = await send();
  check("200 keeps both Set-Cookie lines", (ok.match(/Set-Cookie:/g) ?? []).length === 2, ok.split("\r\n")[0]);
  check("200 keeps the JSON body intact", ok.includes('"OTP_REQUIRED"'));

  nextResponse = {
    status: 401,
    body: JSON.stringify([{ error: { json: { message: "unauthorized", code: -32001, data: { code: "UNAUTHORIZED", httpStatus: 401 } } } }]),
  };
  const rejected = await send();
  check("401 status line reaches the WebView", rejected.startsWith("HTTP/1.1 401"), rejected.split("\r\n")[0]);
  check("401 body reaches the WebView intact", rejected.includes('"httpStatus":401') && rejected.includes("UNAUTHORIZED"));
  console.log("");

  console.log("=== loopback diagnostic lines, as they appear on the phone ===");
  console.log(banner.replace(/[0-9a-f]{64}/g, "<secret>").trim());
  console.log("");

  console.log(`RESULT: ${failures === 0 ? "all checks passed" : `${failures} check(s) FAILED`}`);
  driver.stdin.end();
  upstream.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("loopback payload check failed to run:", error);
  process.exit(1);
});
