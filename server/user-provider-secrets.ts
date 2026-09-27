import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Envelope format for a user-supplied provider API key: `kbyok1.<iv>.<tag>.<cipher>`.
 *
 * The version prefix is checked before anything else, so a blob produced by an older or
 * foreign scheme is rejected instead of being interpreted. AES-256-GCM authenticates the
 * ciphertext, so a modified IV, tag or payload fails the tag check and throws — there is
 * no plaintext path and no "best effort" decryption.
 */
const ENVELOPE_PREFIX = "kbyok1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const BASE64 = "base64url";

export class UserProviderKeyConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserProviderKeyConfigurationError";
  }
}

export class UserProviderKeyDecryptionError extends Error {
  constructor() {
    super("Не удалось расшифровать сохранённый API-ключ.");
    this.name = "UserProviderKeyDecryptionError";
  }
}

let cachedRawKey: string | null | undefined;

/** Test-only: drops the memoised key so a changed env is observed immediately. */
export function __resetUserProviderKeyCacheForTests() {
  cachedRawKey = undefined;
}

/**
 * Reads USER_PROVIDER_KEY_ENCRYPTION_KEY and requires exactly 32 bytes, supplied either as
 * 64 hex characters or base64/base64url of 32 bytes. A missing, blank, truncated or
 * over-long value is a deployment error and is reported as such — it is never stretched or
 * hashed into a key, because a silently derived key turns a typo into a working but
 * misconfigured deployment.
 */
export function loadUserProviderEncryptionKey(): Buffer {
  if (cachedRawKey !== undefined) {
    if (cachedRawKey === null) throw new UserProviderKeyConfigurationError(configurationMessage("не задана"));
    return Buffer.from(cachedRawKey, BASE64);
  }
  const raw = process.env.USER_PROVIDER_KEY_ENCRYPTION_KEY;
  if (typeof raw !== "string" || raw.trim() === "") {
    cachedRawKey = null;
    throw new UserProviderKeyConfigurationError(configurationMessage("не задана"));
  }
  const value = raw.trim();
  const bytes = /^[0-9a-fA-F]{64}$/.test(value) ? Buffer.from(value, "hex") : decodeBase64(value);
  if (!bytes || bytes.length !== KEY_BYTES) {
    cachedRawKey = null;
    throw new UserProviderKeyConfigurationError(configurationMessage(`должна содержать ровно ${KEY_BYTES} байта (64 hex-символа или base64)`));
  }
  cachedRawKey = bytes.toString(BASE64);
  return bytes;
}

function decodeBase64(value: string): Buffer | null {
  try {
    return Buffer.from(value, BASE64);
  } catch {
    return null;
  }
}

function configurationMessage(problem: string): string {
  return `Переменная окружения USER_PROVIDER_KEY_ENCRYPTION_KEY ${problem}. Хранение пользовательских API-ключей невозможно до исправления конфигурации.`;
}

/** True when a key is available. Used to report a configuration problem without leaking it. */
export function isUserProviderKeyEncryptionConfigured(): boolean {
  try {
    loadUserProviderEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptUserProviderSecret(plaintext: string): string {
  if (typeof plaintext !== "string" || plaintext === "") throw new UserProviderKeyConfigurationError("Пустой API-ключ не может быть сохранён.");
  const key = loadUserProviderEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [ENVELOPE_PREFIX, iv.toString(BASE64), cipher.getAuthTag().toString(BASE64), encrypted.toString(BASE64)].join(".");
}

export function decryptUserProviderSecret(envelope: string): string {
  if (typeof envelope !== "string" || envelope === "") throw new UserProviderKeyDecryptionError();
  const parts = envelope.split(".");
  if (parts.length !== 4) throw new UserProviderKeyDecryptionError();
  const [prefix, ivPart, tagPart, cipherPart] = parts as [string, string, string, string];
  if (prefix !== ENVELOPE_PREFIX) throw new UserProviderKeyDecryptionError();
  const key = loadUserProviderEncryptionKey();
  let iv: Buffer;
  let tag: Buffer;
  let payload: Buffer;
  try {
    iv = Buffer.from(ivPart, BASE64);
    tag = Buffer.from(tagPart, BASE64);
    payload = Buffer.from(cipherPart, BASE64);
  } catch {
    throw new UserProviderKeyDecryptionError();
  }
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new UserProviderKeyDecryptionError();
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    // final() is where GCM verifies the authentication tag, in constant time internally.
    // A modified IV, tag or ciphertext all fail here and land in the same catch.
    const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);
    const plaintext = decrypted.toString("utf8");
    if (!plaintext) throw new UserProviderKeyDecryptionError();
    return plaintext;
  } catch {
    // A modified IV, tag or ciphertext all land here; the original failure detail is dropped
    // so a caller cannot distinguish a tampered blob from a wrong key.
    throw new UserProviderKeyDecryptionError();
  }
}

const HINT_VISIBLE = 4;

/**
 * The only representation of a saved key that leaves the server: a fixed mask plus the last
 * few characters. Short keys degrade to a smaller suffix rather than revealing most of the
 * value, and a key shorter than the mask is never echoed at all.
 */
export function userProviderKeyHint(plaintext: string): string {
  if (typeof plaintext !== "string" || plaintext.length < HINT_VISIBLE) return "••••";
  return `••••${plaintext.slice(-HINT_VISIBLE)}`;
}
