# Storage Migration Plan: Manus Forge → Backblaze B2

## Current State Analysis

### Storage Architecture
- **Current**: All storage via Manus Forge Server API (`BUILT_IN_FORGE_API_URL` + `BUILT_IN_FORGE_API_KEY`)
- **Backend**: Forge provides presigned URLs to S3; files stored in Forge-managed S3 buckets
- **Proxy**: `/manus-storage/*` endpoint proxies through Forge for downloads (307 redirect)
- **Dependencies**: `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` already in `package.json`

### Storage Contract (server/storage.ts)
| Function | Current Implementation | Callers |
|----------|------------------------|---------|
| `storagePut(key, data, contentType)` | Forge presign PUT → direct S3 PUT | attachments.ts, chat-exports.ts, imageGeneration.ts |
| `storageGet(key)` | Returns `/manus-storage/{key}` URL | Not directly called (returns path for proxy) |
| `storageGetSignedUrl(key)` | Forge presign GET → returns signed S3 URL | attachments.ts, chat-exports.ts, _core/voiceTranscription.ts |
| `storageDelete(key)` | Forge DELETE API | _core/guest-session.ts (cleanup, promote) |
| `storageCopy(src, dest)` | Forge presign GET + PUT via download/upload | _core/guest-session.ts (promoteGuest) |

### DB References (fileKey patterns)
| Table | fileKey Pattern | Example |
|-------|-----------------|---------|
| `chat_attachments` | `attachments/{userId}/{sessionId}/{uuid}.{ext}` | `attachments/42/abc-123/uuid.png` |
| `chat_exports` | `exports/{userId}/{sessionId}/{uuid}.{ext}` | `exports/42/abc-123/uuid.pdf` |
| `imageGeneration` | `generated/{timestamp}.png` | `generated/1700000000000.png` |
| PDF Font | `kairema-export-dejavu_a34427d0.ttf` | Fixed key |

---

## Migration Strategy: Dual-Write with Gradual Cutover

### Phase 1: Add B2 Implementation (No Cutover)
1. Extend `server/storage.ts` with B2 backend behind feature flag
2. Add B2 env vars to `server/_core/env.ts`
3. Keep Forge as default; B2 opt-in via env var
4. All existing callers continue using Forge

### Phase 2: Migration Script
1. One-time script to copy all existing Forge objects to B2
2. Idempotent: tracks migrated keys in DB or local state file
3. Validates each copy (size, checksum)
4. Updates DB `fileKey` references only after validation

### Phase 3: Cutover
1. Flip default storage backend to B2 via env var
2. Update `/manus-storage/*` proxy to serve from B2
3. Monitor for issues
4. Remove Forge code after validation period

### Phase 4: Cleanup
1. Remove Forge dependencies and code
2. Remove Forge env vars from Render

---

## A) Files to Change

### Core Storage
| File | Changes |
|------|---------|
| `server/storage.ts` | Add B2 backend implementation; feature flag for backend selection; keep Forge as fallback |
| `server/_core/env.ts` | Add B2 env vars (`B2_ENDPOINT`, `B2_KEY_ID`, `B2_APP_KEY`, `B2_BUCKET`, `STORAGE_BACKEND`) |
| `server/_core/storageProxy.ts` | Support both Forge and B2 signed URLs; serve from B2 when cutover |

### Migration
| File | Purpose |
|------|---------|
| `scripts/migrate-storage-forge-to-b2.ts` | One-time migration script (idempotent) |
| `server/_core/migration-tracker.ts` | Track migrated keys (in-memory or temp DB table) |

### Configuration
| File | Changes |
|------|---------|
| `package.json` | No new deps needed (AWS SDK v3 already present) |
| `.env.example` / docs | Document new B2 env vars |

---

## B) Environment Variables

### New B2 Variables (Render)
```bash
# Required for B2 backend
B2_ENDPOINT=https://s3.us-west-004.backblazeb2.com  # or your region
B2_KEY_ID=your_key_id
B2_APP_KEY=your_app_key
B2_BUCKET=kairema-storage

# Feature flag: "forge" (default) | "b2" | "dual"
STORAGE_BACKEND=forge
```

### Existing (Keep During Migration)
```bash
BUILT_IN_FORGE_API_URL=...
BUILT_IN_FORGE_API_KEY=...
```

---

## C) Dependencies

**No new npm dependencies required.** Already available:
- `@aws-sdk/client-s3` ^3.693.0
- `@aws-sdk/s3-request-presigner` ^3.693.0

Backblaze B2 uses S3-compatible API with these packages.

---

## D) Migration of Existing Files

### Algorithm (Idempotent)
```typescript
// For each fileKey in DB (chat_attachments, chat_exports):
// 1. Check if already migrated (tracker)
// 2. Download from Forge via storageGetSignedUrl (Forge path)
// 3. Upload to B2 with same key path
// 4. Verify: HEAD object, compare Content-Length
// 5. Record migration in tracker
// 6. After ALL files migrated: UPDATE DB fileKey (same key, new backend)
```

### Idempotency Mechanisms
| Mechanism | Implementation |
|-----------|----------------|
| Tracker | In-memory `Set<string>` + write to temp JSON file on each batch |
| Resume | On restart, read tracker file, skip already-migrated keys |
| DB Flag | Optional: add `storageBackend` column to `chat_attachments`/`chat_exports` (future-proofing) |
| Re-run Safety | If key exists in B2 with same size, skip (compare HEAD) |

### Tables to Migrate
1. `chat_attachments` (~all user uploads)
2. `chat_exports` (PDF/MD exports)
3. Fixed font key: `kairema-export-dejavu_a34427d0.ttf` (copy once)
4. Image generation artifacts: `generated/*.png`

---

## E) Validation Plan

### Pre-Cutover
- [ ] Migration script completes 100% (no errors)
- [ ] Random sample: verify B2 objects accessible via signed URL
- [ ] Compare object counts: Forge vs B2
- [ ] Verify all `fileKey` references in DB point to existing B2 objects

### Post-Cutover (STORAGE_BACKEND=b2)
- [ ] Attachment upload → appears in B2 bucket
- [ ] Attachment download → signed URL works
- [ ] Chat export create/download works
- [ ] Image generation → stored in B2, URL accessible
- [ ] Guest promotion copies attachments correctly
- [ ] Guest cleanup deletes from B2
- [ ] `/manus-storage/*` proxy returns 307 to B2 signed URL

### Rollback Validation
- [ ] Flip `STORAGE_BACKEND=forge` → all operations work via Forge
- [ ] No data loss during flip

---

## F) Commit Order

| Commit | Scope |
|--------|-------|
| 1 | `server/_core/env.ts` - Add B2 env vars + `STORAGE_BACKEND` flag |
| 2 | `server/storage.ts` - Implement B2 backend (dual-write capable) |
| 3 | `server/_core/storageProxy.ts` - Support B2 signed URLs |
| 4 | `scripts/migrate-storage-forge-to-b2.ts` - Migration script |
| 5 | Run migration on staging (manual step) |
| 6 | `STORAGE_BACKEND=b2` on Render staging |
| 7 | Validate staging for 24-48h |
| 8 | Remove Forge code from `storage.ts`, `storageProxy.ts` |
| 9 | Remove Forge env vars from Render |

---

## G) Rollback Plan

### Trigger Conditions
- Migration script fails >5% of objects
- Post-cutover error rate >1%
- Performance degradation >2x

### Rollback Steps
1. **Immediate**: Set `STORAGE_BACKEND=forge` in Render env
2. **Verify**: All storage operations route through Forge
3. **DB**: No DB changes needed (fileKeys unchanged)
4. **Forge**: Objects still exist (never deleted during migration)
5. **Investigate**: Fix B2 issues, re-run migration if needed

### Safety Guarantees
- Migration script **never deletes** Forge objects
- DB `fileKey` values **unchanged** during migration (same path in B2)
- Forge code remains until explicit removal commit
- Proxy supports both backends simultaneously during transition

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Same `fileKey` paths in B2 | Zero DB migration; keys like `attachments/42/session/uuid.png` work identically |
| S3-compatible SDK | B2 is S3-compatible; existing `@aws-sdk/client-s3` works without new deps |
| Presigned URLs | Maintains same contract: callers get signed URLs, no direct bucket access |
| `/manus-storage/*` proxy | Keeps client-facing URLs stable; backend swaps transparently |
| Feature flag `STORAGE_BACKEND` | Zero-downtime cutover; instant rollback |

---

## Open Questions for Implementation

1. **B2 Bucket Structure**: Single bucket `kairema-storage` with prefixes, or separate buckets per type?
2. **Signed URL TTL**: Match Forge defaults (1hr?) or configure per use-case?
3. **CORS**: B2 bucket CORS must allow browser downloads from app domain
4. **Large Files**: Stream uploads for >8MB? (Current max 8MB for attachments)
5. **Image Generation**: Currently uses Forge ImageService API - keep Forge for generation, only store result in B2?

---

## Out of Scope
- MySQL schema changes (not needed)
- Guest Mode logic changes (uses storage.ts contract)
- AI/Providers/Auth modifications
- Client-side changes (URLs remain `/manus-storage/*`)