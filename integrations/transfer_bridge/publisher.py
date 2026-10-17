import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import PurePosixPath

from .providers import BridgeError, TransferProvider
from .store import BridgeStore, normalize_server, read_manifest


@dataclass(frozen=True)
class PublishResult:
    provider: str
    status: str
    external_id: str
    external_url: str
    content_sha256: str


class Bridge:
    def __init__(self, store: BridgeStore, project_path: str | None = None, profile: str = "default"):
        self.store = store
        self.project_path = project_path or os.getenv("TRANSFER_PROJECT_PATH", "")
        if not profile.strip() or len(profile) > 100:
            raise BridgeError("profile must contain 1 to 100 characters")
        self.profile = profile

    def publish(self, manifest_path: str, provider: str, dry_run: bool = True, force: bool = False) -> PublishResult:
        if provider not in {"feishu", "notion"}:
            raise BridgeError("provider must be feishu or notion")
        manifest = read_manifest(manifest_path)
        source, note, vault = manifest["source"], manifest["note"], manifest["vault"]
        destination = TransferProvider.destination(provider)
        scope = hashlib.sha256(json.dumps(
            [normalize_server(source["server"]), source["uid"], self.profile, destination],
            ensure_ascii=False, separators=(",", ":"),
        ).encode("utf-8")).hexdigest()
        key = (scope, provider, vault, note["path"])
        content_hash = note["content_sha256"]
        if dry_run:
            self.store.record(key, content_hash, "dry-run")
            return PublishResult(provider, "dry-run", "", "", content_hash)
        try:
            publisher = TransferProvider(provider, self.project_path)
            publisher.prepare(PurePosixPath(note["path"]).stem, note["content"])
        except BridgeError as error:
            self.store.record(key, content_hash, "rejected", detail=str(error))
            raise
        except Exception:
            self.store.record(key, content_hash, "rejected", detail="provider preparation failed")
            raise BridgeError("provider preparation failed; check the pinned transfer checkout and dependencies") from None
        status, current = self.store.reserve(key, content_hash, force)
        if status == "unchanged":
            return PublishResult(provider, status, current["external_id"], current["external_url"], content_hash)
        if status == "conflict":
            raise BridgeError("note changed; --force creates a NEW external revision without modifying the old document",
                              "conflict", current["external_id"])
        if status == "blocked":
            raise BridgeError("a previous publication is unfinished or uncertain; inspect history and remote state before retrying",
                              "blocked", current["external_id"])

        def created(external_id: str, external_url: str) -> None:
            self.store.mark(key, "writing", external_id, external_url)

        try:
            external_id, external_url = publisher.create(created)
            if not external_id:
                raise BridgeError("provider returned no document id")
            self.store.mark(key, "created", external_id, external_url)
        except Exception:
            self.store.mark(key, "uncertain", detail="remote result may be partial; automatic retry is disabled")
            current = self.store.get_mapping(key)
            raise BridgeError("publication failed or is incomplete; inspect history for the remote id before retrying",
                              "uncertain", current["external_id"] if current else "") from None
        return PublishResult(provider, "created", external_id, external_url, content_hash)
