# Independent Cloud Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an independently consumable cloud-sync protocol for Vault notes, files, folders, and settings while preserving the legacy Obsidian/FNS sync protocol.

**Architecture:** Keep existing Note/File/Folder/Setting services as the single write path. Add a sync session/device layer that authenticates through existing middleware, records an opaque per-Vault cursor over SyncLog IDs, exposes snapshot/changes/single-operation CAS endpoints, and bridges committed changes to a new WebSocket subscription. Legacy routes remain registered and unchanged.

**Tech Stack:** Go 1.26, Gin, GORM/gen, SQLite/MySQL/PostgreSQL, existing service/repository layers, existing `gws` WebSocket server, React/Vite docs viewer, Go and TypeScript tests.

**Spec:** `docs/superpowers/specs/2026-10-16-independent-cloud-sync.md`

## Global Constraints

- Existing authentication, Vault permissions, token scopes, audit logging, history and recycle-bin behavior remain authoritative.
- Every data write requires version/content-hash/path-hash validation and returns a processable conflict; no silent overwrite.
- Markdown, Frontmatter, original line endings and Unicode must be preserved.
- Client-supplied context is never evidence of authorization; the server rereads resources under the authenticated UID.
- New endpoints use `/api/sync/*`; existing `/api/user/sync` and legacy WebSocket actions remain compatible.
- This phase does not claim multi-document transactions, end-to-end encryption, billing, or quota enforcement.

## Execution Status (2026-10-17)

- Completed in this pass: authenticated `/api/sync/sessions`, persistent device/session/batch/receipt storage in `internal/cloudsync`, repeatable snapshot and final-state change pages, versioned device revoke/rename, single-operation Markdown note CAS using `version + baseContentHash + contentHash`, atomic setting CAS, folder creation, request-id retry receipts, independent `CloudSyncPull`/`CloudSyncPage` WebSocket batch pulling, a reusable `docs-viewer/src/cloud-sync-client.ts` client module with attachment and folder/file helpers, the web “同步设备” settings panel and `/api/sync/status` gate, an independent local Markdown `docs-module`, and `desktop-client/`, which packages the existing Web docs build inside a macOS app and accesses the API through a preload bridge. It does not load a remote `/docs/` page or duplicate the Web UI. The desktop interaction direction references Flowix. Protocol and product documentation plus regression tests are updated. The REST wiring lives in `internal/routers/api_router/handler_cloud_sync.go`.
- Remaining scope: folder rename through the independent operation envelope, local Vault to cloud bidirectional merge, attachment mirroring, real-time push semantics, and full authenticated client end-to-end validation. The Electron macOS client uses the current space root for the local Markdown API and local AI agent; choose another Markdown folder from the app or set `FNS_LOCAL_VAULT`, and set `FNS_DESKTOP_BASE_URL=http://127.0.0.1:9000` to connect it to a cloud service. The Web UI is available at `http://127.0.0.1:4173/docs/`; the backend is running at `http://127.0.0.1:9000`.

---

### Task 1: Add sync device and session domain contracts

**Files:**
- Create: `internal/domain/domain_sync_device.go`
- Create: `internal/model/sync_device.go`
- Modify: `internal/model/model.go`
- Modify: `internal/app/repos.go`
- Modify: `internal/app/services.go`
- Test: `internal/service/sync_device_service_test.go`

**Interfaces:**
- Consumes: authenticated UID, VaultService access checks, GORM database initialization.
- Produces: `SyncDeviceRepository`, `SyncDeviceService`, `SyncSession` validation helpers, and redacted device DTOs.

- [ ] **Step 1: Write failing service tests** for UID isolation, create-or-touch by `(uid, deviceID)`, rename, revoke, and redacted responses.
- [ ] **Step 2: Run** `go test ./internal/service -run SyncDevice -count=1` and verify the new tests fail because the contracts are absent.
- [ ] **Step 3: Implement** the domain interface and GORM model with `uid`, `vault_id`, `device_id`, client metadata, last-seen time, revoked-at and unique `(uid, device_id, vault_id)`; never expose token material.
- [ ] **Step 4: Register** repository, service, and AutoMigrate wiring in the existing application container.
- [ ] **Step 5: Run** `go test ./internal/service -run SyncDevice -count=1` and `go test ./internal/app -run Config -count=1`.

### Task 2: Add ordered cursor reads to SyncLog

**Files:**
- Modify: `internal/domain/domain_sync_log.go`
- Modify: `internal/dao/sync_log_repository.go`
- Modify: `internal/query/sync_log.gen.go` only through generator output if regeneration is required
- Test: `internal/dao/sync_log_repository_test.go`

**Interfaces:**
- Consumes: `SyncLog` rows already written by note/file/folder/setting services.
- Produces: `ListAfterCursor(ctx, uid, vaultID, afterID, limit)` returning stable `(id ASC)` rows and the oldest retained ID for expiry checks.

- [ ] **Step 1: Write failing repository tests** for stable ordering, Vault filtering, limit enforcement, and expired cursors after cleanup.
- [ ] **Step 2: Run** `go test ./internal/dao -run SyncLogCursor -count=1` and verify failure.
- [ ] **Step 3: Implement** the repository query with `id > afterID`, `uid`, `vault_id`, deterministic ascending order and a bounded limit; do not use wall-clock timestamps as the cursor.
- [ ] **Step 4: Add** a cursor codec that rejects malformed, negative, or oversized values without leaking database details.
- [ ] **Step 5: Run** the repository tests and `go test ./internal/dao -run SyncLog -count=1`.

### Task 3: Implement snapshot and changes service

**Files:**
- Create: `internal/service/sync_service.go`
- Create: `internal/dto/sync.go`
- Modify: `internal/app/services.go`
- Test: `internal/service/sync_service_test.go`

**Interfaces:**
- Consumes: `SyncDeviceService`, `SyncLogRepository`, existing Vault/Note/File/Folder/Setting services.
- Produces: `CreateSession`, `Snapshot`, `Changes`, `CommitOperation`, `CloseSession`, with typed `cursor_expired` and `conflict` errors.

- [ ] **Step 1: Write failing tests** for session creation, deterministic snapshot ordering, cursor pagination, deletion events, malformed/expired cursors and redacted DTOs.
- [ ] **Step 2: Run** `go test ./internal/service -run SyncService -count=1` and verify failure.
- [ ] **Step 3: Implement** session validation against the authenticated UID and Vault permission; create an opaque session ID with an expiry and no content in the token.
- [ ] **Step 4: Implement** snapshot assembly from existing list services and changes assembly by rereading current resources for non-delete events; preserve paths, hashes, versions and line endings.
- [ ] **Step 5: Return** `cursor_expired` when the requested cursor predates the retained log window and include `snapshotRequired=true` in the response.
- [ ] **Step 6: Run** the focused service tests and `go test ./internal/service -run 'Sync(Service|Device)' -count=1`.

### Task 4: Implement single-operation CAS commit

**Files:**
- Modify: `internal/service/sync_service.go`
- Modify: `internal/service/note_service.go` only where a stable CAS result is missing
- Modify: `internal/service/file_service.go` only where a stable CAS result is missing
- Create: `internal/service/sync_idempotency.go`
- Test: `internal/service/sync_commit_test.go`

**Interfaces:**
- Consumes: `SyncOperationRequest` with kind/action/path/version/hash and request ID.
- Produces: `SyncOperationResult` with `applied`, `unchanged`, `conflict`, or `rejected` status and the new cursor.

- [ ] **Step 1: Write failing tests** for note upsert, file metadata update, folder rename, setting update, hash mismatch, version mismatch, unchanged retry and duplicate request ID.
- [ ] **Step 2: Run** `go test ./internal/service -run SyncCommit -count=1` and verify failure.
- [ ] **Step 3: Dispatch** one operation to the existing resource service after server-side Vault and path validation; pass the current version/hash through the existing write checks.
- [ ] **Step 4: Store** request ID plus result per authenticated device/session so a retry returns the original result without a second write.
- [ ] **Step 5: Map** conflicts to a stable typed error containing only resource identifiers and current version/hash; do not include credentials or upstream response bodies.
- [ ] **Step 6: Run** focused commit tests plus existing note/file/folder/setting service tests.

### Task 5: Expose REST routes and device management

**Files:**
- Create: `internal/routers/api_router/handler_sync.go`
- Modify: `internal/routers/router_api.go`
- Modify: `internal/routers/api_router/handler_sync_log.go` only for shared response helpers
- Test: `internal/routers/api_router/handler_sync_test.go`
- Modify: `docs/REST_API.md`

**Interfaces:**
- Consumes: authenticated Gin context and `SyncService` methods from Tasks 1–4.
- Produces: `POST/DELETE /api/sync/sessions`, `GET /snapshot`, `GET /changes`, `POST /operations`, and `GET/PATCH/DELETE /api/sync/devices`.

- [ ] **Step 1: Write failing route tests** for auth rejection, Vault denial, successful session/snapshot/changes/commit, 409 conflict, 410 cursor expiry and device revoke.
- [ ] **Step 2: Run** `go test ./internal/routers/api_router -run Sync -count=1` and verify failure.
- [ ] **Step 3: Register** routes behind the same user auth middleware and permission checks used by existing note/file endpoints.
- [ ] **Step 4: Implement** stable JSON response envelopes and bounded pagination; never echo API keys or raw request context.
- [ ] **Step 5: Document** request/response schemas, errors, retry rules, and legacy compatibility in `docs/REST_API.md`.
- [ ] **Step 6: Run** route tests and `go test ./internal/routers/... -run Sync -count=1`.

### Task 6: Add the independent WebSocket subscription

**Files:**
- Create: `internal/routers/websocket_router/ws_cloud_sync.go`
- Modify: `internal/routers/router_websocket.go`
- Modify: `internal/routers/websocket_router/action.go`
- Test: `internal/routers/websocket_router/ws_cloud_sync_test.go`
- Modify: `docs/SyncProtocol.md`

**Interfaces:**
- Consumes: `SyncService.Changes`, authenticated WebSocket client, last acknowledged cursor.
- Produces: `sync.ready`, `sync.change`, `sync.error`, and cursor acknowledgements on the new subscription route.

- [ ] **Step 1: Write failing tests** for ready handshake, Vault isolation, change ordering, acknowledgement, disconnect/reconnect and revoked device behavior.
- [ ] **Step 2: Run** `go test ./internal/routers/websocket_router -run CloudSync -count=1` and verify failure.
- [ ] **Step 3: Register** a new sync action namespace without changing legacy action constants or handlers.
- [ ] **Step 4: Broadcast** only committed changes for the authenticated UID/Vault, with bounded queue behavior and reconnect guidance.
- [ ] **Step 5: Update** `docs/SyncProtocol.md` with message schemas and the cursor recovery flow.
- [ ] **Step 6: Run** focused WebSocket tests and existing WebSocket pipeline tests.

### Task 7: Add web device/sync status entry and validation docs

**Files:**
- Modify: `docs-viewer/src/api.ts`
- Create: `docs-viewer/src/CloudSyncSettings.tsx`
- Modify: `docs-viewer/src/App.tsx`
- Modify: `docs-viewer/src/styles.css`
- Test: `docs-viewer/src/CloudSyncSettings.test.tsx`
- Modify: `PRODUCT.md`
- Modify: `docs-viewer/PRODUCT.md`

**Interfaces:**
- Consumes: REST routes from Task 5 and existing connection/Vault state.
- Produces: a settings entry that lists devices, shows sync status/cursor recovery, and revokes a device without exposing credentials.

- [ ] **Step 1: Write failing UI tests** for loading/redaction, revoke confirmation, conflict/cursor-expiry messages and narrow layout.
- [ ] **Step 2: Run** `npm test -- --run CloudSyncSettings` from `docs-viewer` and verify failure.
- [ ] **Step 3: Implement** API helpers and the compact device/status panel using existing connection headers and error translation.
- [ ] **Step 4: Ensure** revoke and retry states preserve the current Vault and never write local API keys.
- [ ] **Step 5: Update** product docs with only verified behavior and explicit limitations.
- [ ] **Step 6: Run** the full frontend test/build suite.

### Task 8: Full verification and platform record update

**Files:**
- Modify: `docs/superpowers/specs/2026-10-16-independent-cloud-sync.md`
- Modify: `PRODUCT.md`
- Modify: `docs-viewer/PRODUCT.md`
- External page: `平台功能记录`

- [ ] **Step 1: Run** `go test ./...` and `npm run build` in `docs-viewer`.
- [ ] **Step 2: Run** an authenticated integration smoke test covering session, snapshot, change, CAS conflict, retry idempotency, device revoke and WebSocket reconnect.
- [ ] **Step 3: Re-read** the platform page and update the planning entry to “实验中” only if all tested routes are available; include exact validation date and remaining limits.
- [ ] **Step 4: Update** local product docs to match the external record and list rollback paths.
- [ ] **Step 5: Re-run** the focused suites after documentation changes and record the final verification status.
