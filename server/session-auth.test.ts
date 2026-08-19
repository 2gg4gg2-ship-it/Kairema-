import { describe, expect, it } from "vitest";
import { tokenFromMirroredSession } from "../shared/session-auth";

describe("preview session fallback", () => {
  it("extracts the same mirrored Manus session token used by tRPC and streaming", () => {
    expect(tokenFromMirroredSession("theme=dark; manus_session=ignore; app_session_id=preview-token; other=value")).toBe("preview-token");
  });

  it("does not invent an authorization token when the mirrored cookie is absent or blank", () => {
    expect(tokenFromMirroredSession("theme=dark")).toBeNull();
    expect(tokenFromMirroredSession("app_session_id=   ")).toBeNull();
  });
});
