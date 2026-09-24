# Plan: Log MySQL ER_BAD_FIELD_ERROR column via `cause.message`

## Goal
Surface the exact missing-column name from MySQL `ER_BAD_FIELD_ERROR` (errno 1054) by
adding a single `message` field — sourced from the unwrapped `cause`'s `.message` — to
the existing four `RESOLVE_*` diagnostic `console.error` calls in
`server/db.ts`.

## Context / current state
- Current branch: `kilo/polar-albatross-f63` (HEAD clean, working tree clean).
- Function: `resolveOrCreateProviderUser` in `server/db.ts` (lines 154–254).
- It already uses the cause-unwrap pattern (`cause = error?.cause; source = cause ?? error`)
  in all four catch blocks. No 5th `RESOLVE_FINAL_LOOKUP` catch block exists on this branch
  (the final lookup at line 249 is a plain throw with no try/catch).
- Underlying cause: mysql2 `DatabaseError` whose `.message` is
  `ER_BAD_FIELD_ERROR: Unknown column '…' in '…'`. Drizzle wraps it; the wrapped `cause`
  is the mysql2 error, so `source.message` (=`cause.message`) carries the column name.

## Exact change (4 catch blocks, identical pattern)
File: `server/db.ts`
Blocks & line ranges:
1. `RESOLVE_EXISTING_ERROR`  — lines 169–182  (stage=getUserByProviderIdentity)
2. `RESOLVE_UPSERT_ERROR`     — lines 192–205  (stage=upsertUser)
3. `RESOLVE_OPENID_ERROR`     — lines 213–226  (stage=getUserByOpenId)
4. `RESOLVE_LINK_ERROR`       — lines 234–247  (stage=linkProviderIdentityToUser)

In each block, the existing variable setup is:
```ts
const cause = (error as { cause?: unknown })?.cause;
const source = cause ?? error;
const e = source as { code?: unknown; errno?: unknown; syscall?: unknown };
```
Add one line (after `const e = …;`, before `console.error`):
```ts
const message = source?.message?.toString() ?? "none";
```
Then add one template field to the matching `console.error` — place it immediately
after `error_name=…`:
```ts
`message=${message} ` +
```

Example, before → after for block 1 (`RESOLVE_EXISTING_ERROR`, lines 169–182):
```ts
// before (current)
  } catch (error) {
    const cause = (error as { cause?: unknown })?.cause;
    const source = cause ?? error;
    const e = source as { code?: unknown; errno?: unknown; syscall?: unknown };
    console.error(
      `[RESOLVE_EXISTING_ERROR] ` +
      `error_name=${error?.constructor?.name ?? "Error"} ` +
      `errno=${e.errno?.toString() ?? "none"} ` +
      `code=${e.code?.toString() ?? "none"} ` +
      `syscall=${e.syscall?.toString() ?? "none"} ` +
      `stage=getUserByProviderIdentity`
    );
    throw error;
  }

// after (with message field added)
  } catch (error) {
    const cause = (error as { cause?: unknown })?.cause;
    const source = cause ?? error;
    const e = source as { code?: unknown; errno?: unknown; syscall?: unknown };
    const message = source?.message?.toString() ?? "none";
    console.error(
      `[RESOLVE_EXISTING_ERROR] ` +
      `error_name=${error?.constructor?.name ?? "Error"} ` +
      `message=${message} ` +
      `errno=${e.errno?.toString() ?? "none"} ` +
      `code=${e.code?.toString() ?? "none"} ` +
      `syscall=${e.syscall?.toString() ?? "none"} ` +
      `stage=getUserByProviderIdentity`
    );
    throw error;
  }
```
Apply the same two-line addition (one `const message`, one `message=${message} ` field)
to blocks 2–4 only. No other lines change.

## Constraints (hard)
- Do NOT touch the final lookup (line 249–252) — no new try/catch there.
- Do NOT modify DB, schema (`drizzle/schema.ts`), or any migration (`drizzle/*.sql`).
- Do NOT run `upsertUser`/`insert`/`select`/`getUserByProviderIdentity` body changes —
  only the 4 `console.error` strings get the new field.
- Do NOT commit. Do NOT push.
- Keep the existing `stage=` labels, `errno`/`code`/`syscall` field order; only add `message`.

## Security
- mysql2 `.message` = `ER_BAD_FIELD_ERROR: Unknown column '<col>' in '<context>'`.
  It does NOT contain `provider`/`providerSubject` values, so it is safe to log as
  plaintext to the Render error stream. No secret material is logged.

## Verification (run by implementing agent)
1. `git diff server/db.ts` — confirm exactly 8 added lines (2 per block × 4), nothing else.
2. `git diff --check` — no whitespace errors.
3. `pnpm check` — `tsc --noEmit` must pass (the new `message` const is typed as `string`;
   `${message}` interpolation is valid).
4. (Optional, no assertion expected) `pnpm test server/stytch.security.test.ts` — existing
   tests still pass (they slice source but do not assert log format).

## Expected outcome
After deploy, a `ER_BAD_FIELD_ERROR 1054` at `getUserByProviderIdentity` produces output
like:
```
[RESOLVE_EXISTING_ERROR] error_name=DrizzleQueryError message=ER_BAD_FIELD_ERROR: Unknown column 'providerSubject' in 'field list' errno=1054 code=ER_BAD_FIELD_ERROR syscall=none stage=getUserByProviderIdentity
```
The column name is then known and can be matched against the live MySQL
`provider_identities` schema to drive the real schema fix (out of scope for this change).

## Risks / notes
- If the Kilo agent framework auto-commits working-tree edits at turn end, the "do not
  commit" instruction cannot be satisfied via the Edit tool; this should be flagged to the
  user before committing, or the edit should be applied in a mode that leaves the tree dirty.
- `source.message` may be `undefined` for non-Drizzle errors (e.g. "Provider identity
  mapping could not be resolved"); the `?? "none"` fallback handles that gracefully.
