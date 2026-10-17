# Transfer Authenticated API and Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the existing create-only Python bridge through authenticated asynchronous Fast Note Sync APIs.

**Architecture:** Go reads an authorized note snapshot, persists job metadata using the service database, and queues a bounded background job. A fixed Python subprocess consumes a private manifest; its own SQLite database retains external mappings. Administrators bind each profile to one UID, Vault and provider; HTTP callers cannot choose executables, credentials, destinations or content.

**Tech Stack:** Existing Go/Gin/GORM, standard-library process execution, existing Python bridge and unittest.

**Spec:** `docs/transfer-integration.md` plus the user's request to continue into authenticated APIs and a background queue.

## Global Constraints

- Preserve all unrelated uncommitted work; no branches or commits.
- Disabled by default; omitted `live` means dry-run; live also needs profile-level opt-in.
- Require `transfer_r`/`transfer_w`, `note_r`, token Vault access and UID-bound profiles.
- Keep credentials in administrator-selected environment variables, out of requests, responses, job rows and subprocess arguments.
- Use a single local queue worker, bounded capacity and a per-job timeout; never automatically replay interrupted live jobs.
- Publish by creating documents, not by overwriting or deleting external content.

## Task 1: Configuration and bridge protocol

Files: `internal/config/transfer.go`, `internal/app/config.go`, `integrations/transfer_bridge/{cli,publisher,providers}.py`; matching tests.

Interface: `TransferConfig.Validate() error`; CLI `--json-errors` emits classified JSON without stderr or credentials.

- [x] Test disabled defaults, invalid profiles, environment allowlists and machine-readable conflict/uncertain errors.
- [x] Implement validated server settings and provider environment references.
- [x] Add classified Python errors while preserving ordinary CLI behavior.

## Task 2: Persistent jobs and bounded worker

Files: `internal/transfer/{service,runner}.go`, `internal/transfer/{service,runner}_test.go`.

Interfaces: `NewService(config.TransferConfig, *gorm.DB, Runner) (*Service, error)`, `Submit(context.Context, int64, Request, Note) (*Job, error)`, `Get`, `List`, `Profiles`, `Shutdown`.

- [x] Test ownership, queue saturation, duplicate in-flight jobs, timeout and shutdown with fake runners.
- [x] Implement private note snapshots, persisted states and no automatic live retry.
- [x] Verify a real Python dry-run subprocess and private environment/manifest cleanup.

## Task 3: Authenticated routing and lifecycle

Files: `internal/routers/api_router/handler_transfer.go`, `internal/routers/router_api.go`, `internal/app/app.go`; matching tests.

Routes: `GET /api/transfer/profiles?vault=...`, `POST /api/transfer/jobs`, `GET /api/transfer/jobs?vault=...`, `GET /api/transfer/jobs/:id`.

- [x] Test authentication, function scope, Vault restrictions, cross-user lookup, live opt-in, strict input and accepted jobs.
- [x] Fetch notes through `NoteService.Get` rather than trusting request content.
- [x] Start/stop the worker with the application; disabled deployments require no Python installation.

## Task 4: Documentation and verification

Files: `docs/transfer-integration.md`, `config/config.yaml`.

- [x] Document profile configuration, environment variables, API requests/statuses, restart behavior and Python runtime prerequisites.
- [x] Run focused Go tests, Python tests, race checks, Go build and whitespace checks; report unrelated baseline failures separately.
