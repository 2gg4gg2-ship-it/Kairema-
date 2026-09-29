// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";


const KEY = "sk-or-v1-direct-key-aaaa";

/**
 * The logout path is asserted through the real `useAuth` hook, because the guarantee is about the
 * hook's cleanup and not about the key store: a store that can be cleared is useless if nothing
 * calls it when the account ends.
 */
async function loadUseAuth() {
  vi.resetModules();
  const module = await import("@/_core/hooks/useAuth");
  return module.useAuth;
}

beforeEach(() => {
  vi.resetModules();
  vi.doMock("@/lib/trpc", () => ({
    trpc: {
      auth: {
        me: { useQuery: () => ({ data: { id: 1, name: "A" }, isLoading: false }) },
        logout: { useMutation: () => ({ mutateAsync: vi.fn(async () => ({ success: true })), isPending: false }) },
      },
      useUtils: () => ({ auth: { me: { setData: vi.fn(), invalidate: vi.fn(async () => undefined) } } }),
    },
  }));
});

describe("logging out", () => {
  it("removes the direct key from memory", async () => {
    const useAuth = await loadUseAuth();
    const { renderHook, act } = await import("@testing-library/react");
    // Imported after the module reset so this is the *same* store instance the hook closes over.
    // A second copy would have its own Map, and the assertion would pass or fail for the wrong
    // reason entirely.
    const store = await import("@/lib/direct-key-store");
    store.setDirectKey("openrouter", KEY);
    expect(store.getDirectKey("openrouter")).toBe(KEY);
    const { result } = renderHook(() => useAuth());
    await act(async () => { await result.current.logout(); });
    // The key only ever lived in this tab. Leaving it behind would hand the next person to use
    // this browser the previous user's credential, still attached to their provider requests.
    expect(store.getDirectKey("openrouter")).toBeNull();
  });
});
