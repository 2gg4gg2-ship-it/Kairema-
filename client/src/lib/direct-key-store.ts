/**
 * Direct provider key store.
 *
 * A key for a browser-direct provider never reaches the Kairema server. That is the entire point
 * of the direct path, and it is only true if the key is never written anywhere the server could
 * read, and never persisted anywhere that outlives the page.
 *
 * The rules this module enforces:
 *
 * - In memory only. The map is module-scoped and dies with the tab.
 * - sessionStorage is never used. A tab restore is a convenient way to turn a memory-only secret
 *   into a durable one, and the convenience is not worth it. It is opt-in per provider below, and
 *   off everywhere today, so a future provider cannot silently inherit persistence.
 * - localStorage is never used, at all, for any provider. There is no code path that can reach it.
 * - The key is never placed in a URL, in the DOM, or in a log line.
 * - The key is bound to one provider id. Asking for a different provider's key returns nothing
 *   rather than the previously stored one, so a provider switch cannot reuse the old key by
 *   accident.
 */

export type DirectKeyScope = {
  providerId: string;
  key: string;
  /** Milliseconds since the epoch; used to expire a key the user left sitting in memory. */
  storedAt: number;
};

const memory = new Map<string, DirectKeyScope>();

/** Callers wire their own clear-on-logout; this exists so tests and HMR can start from empty. */
export function clearDirectKeys(): void {
  memory.clear();
}

export function hasDirectKey(providerId: string): boolean {
  return memory.has(providerId);
}

/**
 * Stores the key for exactly one provider.
 *
 * Storing a key for a different provider clears the previous one first. This is the switch rule:
 * after a user moves from provider A to provider B, A's key is gone, so a later request that
 * accidentally still names A cannot be signed with it.
 */
export function setDirectKey(providerId: string, key: string): void {
  for (const existing of Array.from(memory.keys())) {
    if (existing !== providerId) memory.delete(existing);
  }
  memory.set(providerId, { providerId, key, storedAt: Date.now() });
}

/** Returns the key only for the exact provider asked for. */
export function getDirectKey(providerId: string): string | null {
  const entry = memory.get(providerId);
  return entry ? entry.key : null;
}

export function clearDirectKey(providerId: string): void {
  memory.delete(providerId);
}

/**
 * The key to sign a request with, or null when there is none for this provider.
 *
 * Kept separate from `getDirectKey` so the call sites that put a key on the wire are greppable.
 */
export function directKeyFor(providerId: string): string | null {
  if (!providerId) return null;
  return getDirectKey(providerId);
}

/**
 * A redacted description for logs and diagnostics.
 *
 * Never returns any part of the key. Support needs to tell two users' keys apart, and a length
 * alone does that without the value being recoverable from a log.
 */
export function describeDirectKey(providerId: string): { providerId: string; present: boolean; length: number } {
  const key = getDirectKey(providerId);
  return { providerId, present: key !== null, length: key ? key.length : 0 };
}
