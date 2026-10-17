import hashlib
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit, urlunsplit


MAX_CONTENT_BYTES = 1024 * 1024


def validate_note_path(value: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 1024:
        raise ValueError("note.path is required and must be at most 1024 characters")
    if "\\" in value or any(ord(character) < 32 for character in value):
        raise ValueError("note.path contains unsupported characters")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in value.split("/")):
        raise ValueError("note.path must be a clean relative path")
    if path.suffix.lower() != ".md":
        raise ValueError("only Markdown (.md) notes can be exported")
    return value


def normalize_server(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("source.server must be a URL")
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("source.server must be an HTTP or HTTPS URL")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("source.server must not contain credentials, query, or fragment")
    return urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path.rstrip("/"), "", ""))


def validate_manifest(manifest: dict) -> dict:
    if not isinstance(manifest, dict) or type(manifest.get("version")) is not int or manifest["version"] != 1:
        raise ValueError("unsupported manifest version")
    source = manifest.get("source")
    if not isinstance(source, dict) or type(source.get("uid")) is not int or source["uid"] <= 0:
        raise ValueError("manifest source.uid must be a positive user id")
    normalize_server(source.get("server"))
    vault = manifest.get("vault")
    if not isinstance(vault, str) or not vault.strip() or len(vault) > 255:
        raise ValueError("manifest vault is required")
    note = manifest.get("note")
    if not isinstance(note, dict):
        raise ValueError("manifest note is required")
    validate_note_path(note.get("path"))
    if not isinstance(note.get("content"), str):
        raise ValueError("manifest note.content is required")
    encoded = note["content"].encode("utf-8")
    if len(encoded) > MAX_CONTENT_BYTES:
        raise ValueError("note exceeds the 1 MiB MVP limit")
    if note.get("content_sha256") != hashlib.sha256(encoded).hexdigest():
        raise ValueError("manifest content_sha256 does not match note.content")
    return manifest


def read_manifest(path: str | Path) -> dict:
    with open(path, "rb") as stream:
        content = stream.read(MAX_CONTENT_BYTES * 8 + 1)
    if len(content) > MAX_CONTENT_BYTES * 8:
        raise ValueError("manifest is too large")
    return validate_manifest(json.loads(content))


class BridgeStore:
    def __init__(self, path: str | Path):
        self.path = str(path)
        if self.path != ":memory:":
            target = Path(self.path)
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            descriptor = os.open(target, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            os.close(descriptor)
            target.chmod(0o600)
        self.db = sqlite3.connect(self.path, timeout=10)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(
            """
            CREATE TABLE IF NOT EXISTS bridge_mappings (
                scope TEXT NOT NULL,
                provider TEXT NOT NULL,
                vault TEXT NOT NULL,
                note_path TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                external_id TEXT NOT NULL DEFAULT '',
                external_url TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY(scope, provider, vault, note_path)
            );
            CREATE TABLE IF NOT EXISTS bridge_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scope TEXT NOT NULL,
                provider TEXT NOT NULL,
                vault TEXT NOT NULL,
                note_path TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                status TEXT NOT NULL,
                external_id TEXT NOT NULL DEFAULT '',
                detail TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );
            """
        )
        self.db.commit()

    def get_mapping(self, key: tuple) -> dict | None:
        row = self.db.execute(
            "SELECT * FROM bridge_mappings WHERE scope = ? AND provider = ? AND vault = ? AND note_path = ?",
            key,
        ).fetchone()
        return dict(row) if row else None

    def record(self, key: tuple, content_hash: str, status: str, external_id: str = "", detail: str = "") -> None:
        with self.db:
            self._history(key, content_hash, status, external_id, detail)

    def _history(self, key: tuple, content_hash: str, status: str, external_id: str = "", detail: str = "") -> None:
        self.db.execute(
            """INSERT INTO bridge_history
               (scope, provider, vault, note_path, content_hash, status, external_id, detail, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (*key, content_hash, status, external_id, detail, datetime.now(timezone.utc).isoformat()),
        )

    def reserve(self, key: tuple, content_hash: str, force: bool) -> tuple[str, dict | None]:
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            current = self.get_mapping(key)
            if current:
                if current["status"] != "created":
                    self._history(key, content_hash, "blocked", current["external_id"])
                    return "blocked", current
                if current["content_hash"] == content_hash:
                    self._history(key, content_hash, "unchanged", current["external_id"])
                    return "unchanged", current
                if not force:
                    self._history(key, content_hash, "conflict", current["external_id"])
                    return "conflict", current
            self.db.execute(
                """INSERT INTO bridge_mappings
                   (scope, provider, vault, note_path, content_hash, status, updated_at)
                   VALUES (?, ?, ?, ?, ?, 'creating', ?)
                   ON CONFLICT(scope, provider, vault, note_path) DO UPDATE SET
                     content_hash = excluded.content_hash,
                     status = 'creating', updated_at = excluded.updated_at""",
                (*key, content_hash, datetime.now(timezone.utc).isoformat()),
            )
            self._history(key, content_hash, "creating")
        return "creating", current

    def mark(self, key: tuple, status: str, external_id: str = "", external_url: str = "", detail: str = "") -> None:
        with self.db:
            self.db.execute(
                """UPDATE bridge_mappings SET status = ?,
                     external_id = CASE WHEN ? = '' THEN external_id ELSE ? END,
                     external_url = CASE WHEN ? = '' THEN external_url ELSE ? END,
                     updated_at = ?
                   WHERE scope = ? AND provider = ? AND vault = ? AND note_path = ?""",
                (status, external_id, external_id, external_url, external_url,
                 datetime.now(timezone.utc).isoformat(), *key),
            )
            current = self.get_mapping(key)
            if current is None:
                raise ValueError("publication reservation is missing")
            self._history(key, current["content_hash"], status, current["external_id"], detail)

    def list_history(self, limit: int = 50) -> list[dict]:
        return [dict(row) for row in self.db.execute(
            "SELECT * FROM bridge_history ORDER BY id DESC LIMIT ?", (max(1, min(limit, 500)),)
        ).fetchall()]

    def close(self) -> None:
        self.db.close()
