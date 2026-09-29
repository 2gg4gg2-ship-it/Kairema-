import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetUserProviderKeyCacheForTests, decryptUserProviderSecret, encryptUserProviderSecret, isUserProviderKeyEncryptionConfigured, userProviderKeyHint, UserProviderKeyConfigurationError, UserProviderKeyDecryptionError } from "./user-provider-secrets";

const KEY = "a".repeat(64);
const SECRET = "sk-or-v1-abcdef0123456789";

beforeEach(() => {
  process.env.USER_PROVIDER_KEY_ENCRYPTION_KEY = KEY;
  __resetUserProviderKeyCacheForTests();
});

afterEach(() => {
  delete process.env.USER_PROVIDER_KEY_ENCRYPTION_KEY;
  __resetUserProviderKeyCacheForTests();
});

describe("user provider secret encryption", () => {
  it("round-trips a secret and stores a versioned envelope with iv, tag and payload", () => {
    const envelope = encryptUserProviderSecret(SECRET);
    const parts = envelope.split(".");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("kbyok1");
    expect(Buffer.from(parts[1]!, "base64url")).toHaveLength(12);
    expect(Buffer.from(parts[2]!, "base64url")).toHaveLength(16);
    expect(parts[3]!.length).toBeGreaterThan(0);
    expect(decryptUserProviderSecret(envelope)).toBe(SECRET);
  });

  it("never contains the plaintext in the stored envelope", () => {
    const envelope = encryptUserProviderSecret(SECRET);
    expect(envelope).not.toContain(SECRET);
    expect(envelope).not.toContain("sk-or-v1");
    expect(Buffer.from(envelope.split(".")[3]!, "base64url").toString("utf8")).not.toContain(SECRET);
  });

  it("produces a different ciphertext each time for the same secret", () => {
    expect(encryptUserProviderSecret(SECRET)).not.toBe(encryptUserProviderSecret(SECRET));
  });

  it("accepts a base64 encoded 32 byte key", () => {
    process.env.USER_PROVIDER_KEY_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    __resetUserProviderKeyCacheForTests();
    expect(decryptUserProviderSecret(encryptUserProviderSecret(SECRET))).toBe(SECRET);
  });

  it("rejects a missing key instead of deriving one", () => {
    delete process.env.USER_PROVIDER_KEY_ENCRYPTION_KEY;
    __resetUserProviderKeyCacheForTests();
    expect(() => encryptUserProviderSecret(SECRET)).toThrow(UserProviderKeyConfigurationError);
    expect(isUserProviderKeyEncryptionConfigured()).toBe(false);
  });

  it("rejects a blank key", () => {
    process.env.USER_PROVIDER_KEY_ENCRYPTION_KEY = "   ";
    __resetUserProviderKeyCacheForTests();
    expect(() => encryptUserProviderSecret(SECRET)).toThrow(UserProviderKeyConfigurationError);
  });

  it("rejects a key of the wrong length rather than hashing or padding it", () => {
    for (const bad of ["a".repeat(63), "a".repeat(65), "a".repeat(32), "not-a-key"]) {
      process.env.USER_PROVIDER_KEY_ENCRYPTION_KEY = bad;
      __resetUserProviderKeyCacheForTests();
      expect(() => encryptUserProviderSecret(SECRET)).toThrow(UserProviderKeyConfigurationError);
      expect(isUserProviderKeyEncryptionConfigured()).toBe(false);
    }
  });

  it("rejects a base64 key of the wrong decoded length", () => {
    process.env.USER_PROVIDER_KEY_ENCRYPTION_KEY = Buffer.alloc(16, 3).toString("base64");
    __resetUserProviderKeyCacheForTests();
    expect(() => encryptUserProviderSecret(SECRET)).toThrow(UserProviderKeyConfigurationError);
  });

  it("fails closed when the ciphertext is modified", () => {
    const [prefix, iv, tag, payload] = encryptUserProviderSecret(SECRET).split(".") as [string, string, string, string];
    const bytes = Buffer.from(payload, "base64url");
    bytes[0] = bytes[0]! ^ 0xff;
    expect(() => decryptUserProviderSecret([prefix, iv, tag, bytes.toString("base64url")].join("."))).toThrow(UserProviderKeyDecryptionError);
  });

  it("fails closed when the iv is modified", () => {
    const [prefix, iv, tag, payload] = encryptUserProviderSecret(SECRET).split(".") as [string, string, string, string];
    const bytes = Buffer.from(iv, "base64url");
    bytes[0] = bytes[0]! ^ 0xff;
    expect(() => decryptUserProviderSecret([prefix, bytes.toString("base64url"), tag, payload].join("."))).toThrow(UserProviderKeyDecryptionError);
  });

  it("fails closed when the authentication tag is modified", () => {
    const [prefix, iv, tag, payload] = encryptUserProviderSecret(SECRET).split(".") as [string, string, string, string];
    const bytes = Buffer.from(tag, "base64url");
    bytes[0] = bytes[0]! ^ 0xff;
    expect(() => decryptUserProviderSecret([prefix, iv, bytes.toString("base64url"), payload].join("."))).toThrow(UserProviderKeyDecryptionError);
  });

  it("fails closed when the envelope is decrypted under a different key", () => {
    const envelope = encryptUserProviderSecret(SECRET);
    process.env.USER_PROVIDER_KEY_ENCRYPTION_KEY = "b".repeat(64);
    __resetUserProviderKeyCacheForTests();
    expect(() => decryptUserProviderSecret(envelope)).toThrow(UserProviderKeyDecryptionError);
  });

  it("rejects a foreign or truncated envelope shape", () => {
    expect(() => decryptUserProviderSecret("plaintext-secret")).toThrow(UserProviderKeyDecryptionError);
    expect(() => decryptUserProviderSecret("kbyok2.a.b.c")).toThrow(UserProviderKeyDecryptionError);
    expect(() => decryptUserProviderSecret("kbyok1.only.two")).toThrow(UserProviderKeyDecryptionError);
    expect(() => decryptUserProviderSecret("")).toThrow(UserProviderKeyDecryptionError);
  });

  it("rejects an iv of the wrong size", () => {
    const [prefix, , tag, payload] = encryptUserProviderSecret(SECRET).split(".") as [string, string, string, string];
    expect(() => decryptUserProviderSecret([prefix, Buffer.alloc(8).toString("base64url"), tag, payload].join("."))).toThrow(UserProviderKeyDecryptionError);
  });

  it("reports the same failure for tampering as for a wrong key", () => {
    const envelope = encryptUserProviderSecret(SECRET);
    const [prefix, iv, tag, payload] = envelope.split(".") as [string, string, string, string];
    const bytes = Buffer.from(payload, "base64url");
    bytes[0] = bytes[0]! ^ 0xff;
    let tampered: Error | null = null;
    let wrongKey: Error | null = null;
    try { decryptUserProviderSecret([prefix, iv, tag, bytes.toString("base64url")].join(".")); } catch (error) { tampered = error as Error; }
    process.env.USER_PROVIDER_KEY_ENCRYPTION_KEY = "c".repeat(64);
    __resetUserProviderKeyCacheForTests();
    try { decryptUserProviderSecret(envelope); } catch (error) { wrongKey = error as Error; }
    expect(tampered?.message).toBe(wrongKey?.message);
  });

  it("refuses to encrypt an empty secret", () => {
    expect(() => encryptUserProviderSecret("")).toThrow(UserProviderKeyConfigurationError);
  });
});

describe("user provider key hint", () => {
  it("shows only the last four characters behind a fixed mask", () => {
    expect(userProviderKeyHint("sk-or-v1-abcdef0123456789")).toBe("••••6789");
  });

  it("never reveals the key for a very short secret", () => {
    expect(userProviderKeyHint("abc")).toBe("••••");
    expect(userProviderKeyHint("")).toBe("••••");
  });

  it("exposes at most four characters of any secret", () => {
    const secret = "x".repeat(64);
    const hint = userProviderKeyHint(secret);
    expect(hint.replace("••••", "").length).toBeLessThanOrEqual(4);
  });
});
