import { describe, expect, it } from "vitest";
import {
  MAX_ENDPOINT_URL_LENGTH,
  MAX_PROVIDER_NAME_LENGTH,
  UserProviderEndpointError,
  buildUserProviderChatEndpoint,
  buildUserProviderModelsEndpoint,
  normalizeUserProviderDisplayName,
  parseOptionalUserProviderEndpoint,
  parseUserProviderEndpoint,
} from "./user-provider-endpoints";

/**
 * The custom provider flow lets a user name a URL, so these tests are the last gate before the
 * server issues a request to it. A regression here is a server-side request forgery hole.
 */
describe("user provider endpoint security", () => {
  describe("accepted endpoints", () => {
    it("accepts a public https endpoint", () => {
      const url = parseUserProviderEndpoint("https://api.example.com/v1");
      expect(url.hostname).toBe("api.example.com");
      expect(url.protocol).toBe("https:");
    });

    it("accepts an https endpoint with a port-free subdomain and query-free path", () => {
      expect(parseUserProviderEndpoint("https://llm-gateway.eu.example.org/openai/v1").hostname).toBe("llm-gateway.eu.example.org");
    });

    it("normalises the parsed host to lower case", () => {
      expect(parseUserProviderEndpoint("https://API.Example.COM/v1").hostname).toBe("api.example.com");
    });

    it("keeps a genuinely public IPv4 address usable", () => {
      expect(parseUserProviderEndpoint("https://93.184.216.34/v1").hostname).toBe("93.184.216.34");
    });
  });

  describe("rejected schemes and shapes", () => {
    it("rejects http", () => {
      expect(() => parseUserProviderEndpoint("http://api.example.com/v1")).toThrow(/https/);
    });

    it("rejects non-http protocols", () => {
      expect(() => parseUserProviderEndpoint("ftp://api.example.com/v1")).toThrow(UserProviderEndpointError);
      expect(() => parseUserProviderEndpoint("file:///etc/passwd")).toThrow(UserProviderEndpointError);
      expect(() => parseUserProviderEndpoint("gopher://api.example.com")).toThrow(UserProviderEndpointError);
    });

    it("rejects a protocol-relative or schemeless value", () => {
      expect(() => parseUserProviderEndpoint("//api.example.com/v1")).toThrow(UserProviderEndpointError);
      expect(() => parseUserProviderEndpoint("api.example.com/v1")).toThrow(/корректным URL/);
    });

    it("rejects embedded credentials", () => {
      expect(() => parseUserProviderEndpoint("https://user:pass@api.example.com/v1")).toThrow(/логин или пароль/);
    });

    it("rejects a non-standard port", () => {
      expect(() => parseUserProviderEndpoint("https://api.example.com:8080/v1")).toThrow(/443/);
    });

    it("rejects a malformed URL", () => {
      expect(() => parseUserProviderEndpoint("https://")).toThrow(UserProviderEndpointError);
      expect(() => parseUserProviderEndpoint("   ")).toThrow(/не указан/);
    });

    it("rejects an excessive URL length", () => {
      const long = `https://api.example.com/${"a".repeat(MAX_ENDPOINT_URL_LENGTH)}`;
      expect(() => parseUserProviderEndpoint(long)).toThrow(/слишком длинный/);
    });
  });

  describe("internal network is unreachable", () => {
    it("rejects localhost by name and by suffix", () => {
      expect(() => parseUserProviderEndpoint("https://localhost/v1")).toThrow(/внутренний адрес/);
      expect(() => parseUserProviderEndpoint("https://api.localhost/v1")).toThrow(/внутренний адрес/);
      expect(() => parseUserProviderEndpoint("https://db.internal/v1")).toThrow(/внутренний адрес/);
      expect(() => parseUserProviderEndpoint("https://printer.local/v1")).toThrow(/внутренний адрес/);
    });

    it("rejects loopback and this-network IPv4", () => {
      expect(() => parseUserProviderEndpoint("https://127.0.0.1/v1")).toThrow(/внутренний адрес/);
      expect(() => parseUserProviderEndpoint("https://127.1.2.3/v1")).toThrow(/внутренний адрес/);
      expect(() => parseUserProviderEndpoint("https://0.0.0.0/v1")).toThrow(/внутренний адрес/);
    });

    it("rejects private IPv4 ranges", () => {
      expect(() => parseUserProviderEndpoint("https://10.0.0.1/v1")).toThrow(/внутренний адрес/);
      expect(() => parseUserProviderEndpoint("https://172.16.0.1/v1")).toThrow(/внутренний адрес/);
      expect(() => parseUserProviderEndpoint("https://172.31.255.255/v1")).toThrow(/внутренний адрес/);
      expect(() => parseUserProviderEndpoint("https://192.168.1.1/v1")).toThrow(/внутренний адрес/);
    });

    it("rejects link-local and carrier-grade NAT", () => {
      expect(() => parseUserProviderEndpoint("https://169.254.169.254/v1")).toThrow(/внутренний адрес/);
      expect(() => parseUserProviderEndpoint("https://100.100.100.200/v1")).toThrow(/внутренний адрес/);
    });

    it("rejects IPv6 loopback and private ranges", () => {
      expect(() => parseUserProviderEndpoint("https://[::1]/v1")).toThrow(/внутренний адрес/);
      expect(() => parseUserProviderEndpoint("https://[::]/v1")).toThrow(/внутренний адрес/);
      expect(() => parseUserProviderEndpoint("https://[fd00::1]/v1")).toThrow(/внутренний адрес/);
      expect(() => parseUserProviderEndpoint("https://[fe80::1]/v1")).toThrow(/внутренний адрес/);
    });

    it("rejects an IPv4-mapped IPv6 address that points inside", () => {
      expect(() => parseUserProviderEndpoint("https://[::ffff:127.0.0.1]/v1")).toThrow(/внутренний адрес/);
      expect(() => parseUserProviderEndpoint("https://[::ffff:10.0.0.5]/v1")).toThrow(/внутренний адрес/);
    });

    it("rejects cloud metadata endpoints", () => {
      expect(() => parseUserProviderEndpoint("https://metadata.google.internal/v1")).toThrow(/внутренний адрес/);
      expect(() => parseUserProviderEndpoint("https://metadata/v1")).toThrow(/внутренний адрес/);
      expect(() => parseUserProviderEndpoint("https://169.254.169.254/v1")).toThrow(/внутренний адрес/);
    });

    it("is not fooled by a blocked host hiding behind userinfo", () => {
      expect(() => parseUserProviderEndpoint("https://127.0.0.1@api.example.com/v1")).toThrow(/логин или пароль/);
    });
  });

  describe("optional endpoint", () => {
    it("returns null for a blank value and validates a real one", () => {
      expect(parseOptionalUserProviderEndpoint(null, "Models endpoint")).toBeNull();
      expect(parseOptionalUserProviderEndpoint("   ", "Models endpoint")).toBeNull();
      expect(parseOptionalUserProviderEndpoint("https://api.example.com/v1/models", "Models endpoint")?.pathname).toBe("/v1/models");
    });
  });

  describe("display name", () => {
    it("trims and collapses whitespace", () => {
      expect(normalizeUserProviderDisplayName("  My    Gateway  ")).toBe("My Gateway");
    });

    it("rejects a blank or excessive name", () => {
      expect(() => normalizeUserProviderDisplayName("   ")).toThrow(/Укажите название/);
      expect(() => normalizeUserProviderDisplayName("x".repeat(MAX_PROVIDER_NAME_LENGTH + 1))).toThrow(/не должно превышать/);
    });
  });

  describe("deterministic endpoint construction", () => {
    it("builds /chat/completions from a base URL", () => {
      expect(buildUserProviderChatEndpoint("https://api.example.com/v1").toString()).toBe("https://api.example.com/v1/chat/completions");
    });

    it("builds /models from a base URL", () => {
      expect(buildUserProviderModelsEndpoint("https://api.example.com/v1").toString()).toBe("https://api.example.com/v1/models");
    });

    it("tolerates a trailing slash", () => {
      expect(buildUserProviderChatEndpoint("https://api.example.com/v1/").toString()).toBe("https://api.example.com/v1/chat/completions");
      expect(buildUserProviderModelsEndpoint("https://api.example.com/v1/").toString()).toBe("https://api.example.com/v1/models");
    });

    it("keeps a base URL that already is the completion path", () => {
      expect(buildUserProviderChatEndpoint("https://api.example.com/v1/chat/completions").toString()).toBe("https://api.example.com/v1/chat/completions");
      expect(buildUserProviderModelsEndpoint("https://api.example.com/v1/chat/completions").toString()).toBe("https://api.example.com/v1/models");
    });

    it("does not duplicate a suffix that is already present", () => {
      expect(buildUserProviderChatEndpoint("https://api.example.com/v1/chat/completions").toString()).toBe(buildUserProviderChatEndpoint("https://api.example.com/v1/chat/completions").toString());
    });

    it("prefers an explicit models endpoint over the derived one", () => {
      expect(buildUserProviderModelsEndpoint("https://api.example.com/v1", "https://api.example.com/custom/catalog").toString()).toBe("https://api.example.com/custom/catalog");
    });

    it("refuses to build from an internal base URL", () => {
      expect(() => buildUserProviderChatEndpoint("http://127.0.0.1/v1")).toThrow(/https/);
      expect(() => buildUserProviderModelsEndpoint("https://localhost/v1")).toThrow(/внутренний адрес/);
      expect(() => buildUserProviderModelsEndpoint("https://api.example.com/v1", "https://10.0.0.1/v1/models")).toThrow(/внутренний адрес/);
    });

    it("handles a host root without a base path", () => {
      expect(buildUserProviderChatEndpoint("https://api.example.com").toString()).toBe("https://api.example.com/chat/completions");
      expect(buildUserProviderModelsEndpoint("https://api.example.com").toString()).toBe("https://api.example.com/models");
    });
  });
});
