# Transfer Integration MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe, manually triggered boundary for exporting Fast Note Sync Markdown notes to the external `sepao/transfer` workflow.

**Architecture:** Keep the Go service authoritative for note access and authentication. Add a standalone Python adapter that consumes exported Markdown and owns provider credentials/mappings in its own SQLite database. The first release only creates external documents or performs a dry run; it never uses the upstream project's unsafe append-based update path.

**Tech Stack:** Python 3.10+, standard library, optional `sepao/transfer` checkout as a runtime dependency, SQLite.

**Spec:** Manual one-way publishing from a Fast Note Sync Vault to Notion or Feishu, with dry-run and durable mapping/history.

## Global Constraints

- Do not overwrite or revert existing uncommitted user changes.
- Do not copy source from `sepao/transfer`; its repository does not declare a license.
- Provider secrets stay in environment variables and never enter mapping files or logs.
- External execution is disabled unless `--live`, the provider secrets, and the external checkout are explicitly configured.
- External document updates are not attempted; `--force` creates a new revision instead.

---

### Task 1: Add standalone adapter package

**Files:**
- Create: `integrations/transfer_bridge/__init__.py`
- Create: `integrations/transfer_bridge/cli.py`
- Create: `integrations/transfer_bridge/store.py`
- Create: `integrations/transfer_bridge/publisher.py`
- Create: `integrations/transfer_bridge/test_bridge.py`

- [x] Define JSON input manifest and output result contracts.
- [x] Add SQLite mappings and execution history.
- [x] Implement dry-run and explicit create-only publishing.
- [x] Add tests with fake providers and temporary databases.

### Task 2: Add Fast Note Sync export command

**Files:**
- Create: `integrations/transfer_bridge/export_fns.py`
- Create: `integrations/transfer_bridge/test_export_fns.py`

- [x] Fetch one authorized note through the existing REST API.
- [x] Validate the returned path belongs to the requested Vault.
- [x] Write an isolated manifest and Markdown staging file.

### Task 3: Document deployment and usage

**Files:**
- Create: `docs/transfer-integration.md`
- Modify: `README.md`
- Modify: `.gitignore`

- [x] Document environment variables, dry-run, create-only semantics, and operator-managed cleanup.
- [x] Document how to point the adapter at an external `transfer` checkout without vendoring it.
- [x] Ignore local adapter state and staging output.

### Task 4: Verify

- [x] Run adapter unit tests.
- [x] Run Python compile checks.
- [x] Run the existing Go test target only if dependencies are already available.
