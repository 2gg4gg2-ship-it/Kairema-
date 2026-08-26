import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { RequestError, StytchError } from "stytch";
import { getSafeStytchDeliveryFailure } from "./stytch";

function providerError(errorType: string, statusCode: number) {
  return new StytchError({
    status_code: statusCode,
    request_id: "provider-request-id-must-not-persist",
    error_type: errorType,
    error_message: "private provider text must not persist",
    error_url: "https://private.example/error",
    error_details: new Map([["email", "private@example.test"]]),
  });
}

describe("Stytch delivery observability privacy boundary", () => {
  it("converts provider errors only to fixed Kairema-owned categories", () => {
    expect(getSafeStytchDeliveryFailure(providerError("invalid_email", 400))).toBe("ADDRESS_INVALID");
    expect(getSafeStytchDeliveryFailure(providerError("inactive_email", 400))).toBe("ADDRESS_INACTIVE");
    expect(getSafeStytchDeliveryFailure(providerError("no_match_for_provided_magic_link_url", 400))).toBe("CALLBACK_URL_REJECTED");
    expect(getSafeStytchDeliveryFailure(providerError("unknown_provider_type", 400))).toBe("REQUEST_REJECTED");
    expect(getSafeStytchDeliveryFailure(providerError("temporary_error", 503))).toBe("PROVIDER_UNAVAILABLE");
    expect(getSafeStytchDeliveryFailure(new RequestError("transport failed", {} as never))).toBe("PROVIDER_UNAVAILABLE");
  });

  it("records only the fixed category for resend failures and retains the generic public response", async () => {
    const source = await readFile(resolve(process.cwd(), "server/routers.ts"), "utf8");
    const start = source.indexOf("resendVerification: publicProcedure");
    const end = source.indexOf("login: publicProcedure", start);
    const resendSource = source.slice(start, end);

    expect(resendSource).toContain("getSafeStytchDeliveryFailure(error)");
    expect(resendSource).toContain('recordTechnicalEvent({ kind: "provider", title: "Stytch verification delivery request rejected", code: deliveryFailure })');
    expect(resendSource).toContain('return { state: "DELIVERY_REQUESTED" as const }');
    expect(resendSource).toContain('if (toSafeStytchError(error).safeCode === "UNAVAILABLE") throw stytchErrorToTrpc(error)');
    expect(resendSource).not.toMatch(/recordTechnicalEvent\(\{[^}]+(input\.email|request_id|error_type|error_message|error_details|callbackUrl)/s);
  });
});
