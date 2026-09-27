/**
 * Safe handling of endpoints a user types in.
 *
 * A user-supplied URL is a server-side request forgery primitive unless every hop is checked
 * here: the server would otherwise fetch whatever the browser could name, including loopback
 * interfaces, the private network of the deployment and cloud metadata services. Client-side
 * validation is irrelevant because the server is the one making the request, so this module is
 * the only gate and it must run before every custom fetch.
 *
 * Decisions are made on the parsed, normalised host rather than on the raw string, so
 * `http://`, userinfo tricks, decimal or octal IPv4 forms and bracketed IPv6 literals cannot be
 * used to slip past a substring check.
 */

export const MAX_ENDPOINT_URL_LENGTH = 300;
export const MAX_PROVIDER_NAME_LENGTH = 60;

/** Thrown for any endpoint this module refuses; the message is safe to show a user. */
export class UserProviderEndpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserProviderEndpointError";
  }
}

/**
 * Hostnames that always resolve to the deployment itself or to a metadata service. They are
 * matched on the normalised host, so casing, a trailing dot and mixed separators do not help.
 */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "instance-data.ec2.internal",
]);

/** Suffixes reserved for local or internal name resolution. */
const BLOCKED_HOSTNAME_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".home.arpa"];

function isBlockedIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const numbers = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  if (numbers.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  const [a, b] = numbers as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 carrier-grade NAT
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking range
  if (a >= 224) return true; // multicast and reserved
  return false;
}

/**
 * Converts the tail of an IPv4-mapped IPv6 address into dotted-decimal form.
 *
 * The URL parser normalises `[::ffff:127.0.0.1]` to the hex form `::ffff:7f00:1`, so the mapped
 * address has to be rebuilt from its two 16-bit groups before it can be judged as IPv4. Without
 * this an internal address would pass as an ordinary public IPv6 host.
 */
function mappedIpv4Tail(value: string): string | null {
  const match = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(value);
  if (!match) return null;
  const high = Number.parseInt(match[1]!, 16);
  const low = Number.parseInt(match[2]!, 16);
  if (!Number.isInteger(high) || !Number.isInteger(low)) return null;
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

function isBlockedIpv6(host: string): boolean {
  // The URL parser keeps IPv6 literals in brackets; strip them before inspecting.
  const inner = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  const value = inner.toLowerCase();
  if (!value.includes(":")) return false;
  if (value === "::" || value === "::1") return true; // unspecified, loopback
  if (value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb")) return true; // fe80::/10 link-local
  if (/^f[cd]/.test(value)) return true; // fc00::/7 unique local, i.e. private
  // IPv4-mapped (::ffff:a.b.c.d, normalised to ::ffff:hhhh:hhhh) must be judged as IPv4.
  const mapped = mappedIpv4Tail(value);
  if (mapped) return isBlockedIpv4(mapped);
  return false;
}

function isBlockedHostName(host: string): boolean {
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  return BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/** Anything that is not a dotted-decimal IPv4 or an IPv6 literal is a DNS name. */
function looksLikeIpv4(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

function looksLikeIpv6(host: string): boolean {
  return host.includes(":");
}

/**
 * Parses and validates a user-supplied endpoint.
 *
 * Only `https` is accepted, embedded credentials are rejected, and the host is checked against
 * the loopback, private, link-local and metadata ranges. The returned URL is normalised, so
 * callers can build request URLs from it without re-parsing untrusted input.
 */
export function parseUserProviderEndpoint(raw: string, label = "API endpoint"): URL {
  if (typeof raw !== "string") throw new UserProviderEndpointError(`${label} не указан.`);
  const value = raw.trim();
  if (!value) throw new UserProviderEndpointError(`${label} не указан.`);
  if (value.length > MAX_ENDPOINT_URL_LENGTH) throw new UserProviderEndpointError(`${label} слишком длинный (максимум ${MAX_ENDPOINT_URL_LENGTH} символов).`);

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UserProviderEndpointError(`${label} не является корректным URL.`);
  }

  if (url.protocol !== "https:") throw new UserProviderEndpointError(`${label} должен использовать https.`);
  if (url.username || url.password) throw new UserProviderEndpointError(`${label} не должен содержать логин или пароль.`);
  if (url.port && url.port !== "443") throw new UserProviderEndpointError(`${label} должен использовать стандартный порт 443.`);

  const host = url.hostname.toLowerCase();
  if (!host) throw new UserProviderEndpointError(`${label} не содержит корректного домена.`);

  if (looksLikeIpv4(host)) {
    if (isBlockedIpv4(host)) throw new UserProviderEndpointError(`${label} указывает на внутренний адрес, доступ к которому запрещён.`);
    return url;
  }
  if (looksLikeIpv6(host)) {
    if (isBlockedIpv6(host)) throw new UserProviderEndpointError(`${label} указывает на внутренний адрес, доступ к которому запрещён.`);
    return url;
  }
  // A DNS name that is not a literal still has to stay away from obviously local names.
  if (isBlockedHostName(host)) throw new UserProviderEndpointError(`${label} указывает на внутренний адрес, доступ к которому запрещён.`);
  return url;
}

/** Same rules as {@link parseUserProviderEndpoint}, for a value that may be left blank. */
export function parseOptionalUserProviderEndpoint(raw: string | null | undefined, label: string): URL | null {
  if (raw === null || raw === undefined || String(raw).trim() === "") return null;
  return parseUserProviderEndpoint(String(raw), label);
}

/** Trims a user-supplied display name and refuses the extremes. */
export function normalizeUserProviderDisplayName(raw: string): string {
  const value = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (!value) throw new UserProviderEndpointError("Укажите название провайдера.");
  if (value.length > MAX_PROVIDER_NAME_LENGTH) throw new UserProviderEndpointError(`Название провайдера не должно превышать ${MAX_PROVIDER_NAME_LENGTH} символов.`);
  return value;
}

/** Drops a trailing slash so path joining stays predictable. */
function stripTrailingSlash(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/**
 * Appends a path to a base path.
 *
 * A root base collapses to an empty string on purpose: joining onto "/" would produce "//x",
 * which the URL parser would then read as a protocol-relative URL pointing at a different host.
 */
function joinPath(base: string, suffix: string): string {
  const left = base === "/" ? "" : stripTrailingSlash(base);
  const right = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return `${left}${right}`;
}

const CHAT_SUFFIX = "/chat/completions";
const MODELS_SUFFIX = "/models";

/**
 * Builds the inference endpoint from a validated base URL.
 *
 * The base URL is treated as an OpenAI-compatible root, so `https://host/v1` becomes
 * `https://host/v1/chat/completions`. A base that already points at the completion path is kept
 * as is, which lets a provider expose a non-standard route without inventing a new field.
 */
export function buildUserProviderChatEndpoint(baseUrl: string): URL {
  const url = parseUserProviderEndpoint(baseUrl, "API endpoint");
  const path = stripTrailingSlash(url.pathname);
  if (path.endsWith(CHAT_SUFFIX)) return url;
  return parseUserProviderEndpoint(new URL(joinPath(path, CHAT_SUFFIX), url.origin).toString(), "API endpoint");
}

/**
 * Builds the catalog endpoint. An explicit models endpoint always wins; otherwise the standard
 * `/models` sibling of the base URL is used. When the base is a completion path, its sibling
 * directory is used, so `.../v1/chat/completions` still yields `.../v1/models`.
 */
export function buildUserProviderModelsEndpoint(baseUrl: string, modelsEndpoint?: string | null): URL {
  const explicit = parseOptionalUserProviderEndpoint(modelsEndpoint, "Models endpoint");
  if (explicit) return explicit;
  const url = parseUserProviderEndpoint(baseUrl, "API endpoint");
  const path = stripTrailingSlash(url.pathname);
  if (path.endsWith(CHAT_SUFFIX)) {
    const base = path.slice(0, -CHAT_SUFFIX.length) || "/";
    return parseUserProviderEndpoint(new URL(joinPath(base, MODELS_SUFFIX), url.origin).toString(), "Models endpoint");
  }
  if (path.endsWith(MODELS_SUFFIX)) return url;
  return parseUserProviderEndpoint(new URL(joinPath(path, MODELS_SUFFIX), url.origin).toString(), "Models endpoint");
}
