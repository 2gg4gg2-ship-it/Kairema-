import { encodeOAuthState } from "@shared/const";
import { describe, expect, it } from "vitest";
import { getTrustedAppRoot } from "./oauth";
import { sdk } from "./sdk";

describe("OAuth callback return", () => {
  it("returns to the public app root encoded by the initiating HTTPS callback", () => {
    const state = encodeOAuthState({
      redirectUri: "https://kairema-ai-gxujplkn.manus.space/api/oauth/callback",
      nonce: "test-nonce",
    });

    expect(getTrustedAppRoot(state)).toBe("https://kairema-ai-gxujplkn.manus.space/");
  });

  it("falls back to the fixed local root for a malformed or non-callback redirect", () => {
    expect(getTrustedAppRoot("not-base64")).toBe("/");
    expect(
      getTrustedAppRoot(
        encodeOAuthState({
          redirectUri: "https://untrusted.example/elsewhere",
          nonce: "test-nonce",
        })
      )
    ).toBe("/");
  });

  it("accepts an OAuth session when the optional display name is empty", async () => {
    const token = await sdk.createSessionToken("oauth-test-open-id", {
      name: "",
      expiresInMs: 60_000,
    });

    await expect(sdk.verifySession(token)).resolves.toMatchObject({
      openId: "oauth-test-open-id",
      name: "",
    });
  });
});
