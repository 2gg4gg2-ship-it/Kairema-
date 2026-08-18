import { describe, expect, it } from "vitest";
import { requireOwnedSession } from "./db";

describe("chat history ownership", () => {
  it("permits only the owner of a session", () => {
    const owned = { id: "d404ab28-9390-4b4d-a15c-7bb7bd703ad2", userId: 41 };
    expect(requireOwnedSession(41, owned)).toBe(owned);
  });

  it("rejects a missing session and another user's session", () => {
    expect(() => requireOwnedSession(41, undefined)).toThrow("Чат не найден или недоступен.");
    expect(() => requireOwnedSession(41, { id: "3dd0b414-e66e-4f35-9a72-38c8363b9b7b", userId: 42 })).toThrow("Чат не найден или недоступен.");
  });
});
