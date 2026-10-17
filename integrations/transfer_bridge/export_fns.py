import argparse
import hashlib
import json
import os
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from .store import MAX_CONTENT_BYTES, normalize_server, validate_manifest, validate_note_path


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        raise ValueError("Fast Note Sync redirects are refused; configure its final base URL")


def fetch_note(base_url: str, token: str, vault: str, path: str, client: str = "transfer-bridge",
               allow_insecure_http: bool = False) -> dict:
    base_url = normalize_server(base_url)
    validate_note_path(path)
    address = urllib.parse.urlsplit(base_url)
    if address.scheme == "http" and address.hostname not in {"localhost", "127.0.0.1", "::1"} and not allow_insecure_http:
        raise ValueError("non-local Fast Note Sync requires HTTPS; use --allow-insecure-http only on trusted networks")
    if not token or "\n" in token or "\r" in token:
        raise ValueError("FNS_AUTH_TOKEN is required")
    opener = urllib.request.build_opener(NoRedirect())

    def get(endpoint: str) -> dict:
        request = urllib.request.Request(
            base_url + endpoint,
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json",
                     "x-client": client, "x-client-name": "TransferBridge"},
        )
        try:
            with opener.open(request, timeout=30) as response:
                raw = response.read(MAX_CONTENT_BYTES * 8 + 1)
            if len(raw) > MAX_CONTENT_BYTES * 8:
                raise ValueError("Fast Note Sync response is too large")
            payload = json.loads(raw)
        except urllib.error.HTTPError as error:
            raise ValueError(f"Fast Note Sync returned HTTP {error.code}") from None
        except (urllib.error.URLError, TimeoutError):
            raise ValueError("Fast Note Sync connection failed") from None
        if not isinstance(payload, dict) or payload.get("status") is not True:
            raise ValueError("Fast Note Sync rejected the request; check token, client scope, and Vault permissions")
        if not isinstance(payload.get("data"), dict):
            raise ValueError("Fast Note Sync returned an invalid response")
        return payload["data"]

    user = get("/api/user/info")
    if type(user.get("uid")) is not int or user["uid"] <= 0:
        raise ValueError("Fast Note Sync returned an invalid user identity")
    query = urllib.parse.urlencode({"vault": vault, "path": path})
    note = get(f"/api/note?{query}")
    if note.get("path") != path or not isinstance(note.get("content"), str):
        raise ValueError("Fast Note Sync returned a different or invalid note")
    return {"path": path, "content": note["content"], "mtime": note.get("mtime", 0),
            "source": {"server": base_url, "uid": user["uid"]}}


def write_manifest(note: dict, vault: str, output_dir: str) -> str:
    content = note["content"]
    manifest = validate_manifest({
        "version": 1, "source": note["source"], "vault": vault,
        "note": {"path": note["path"], "content": content,
                 "content_sha256": hashlib.sha256(content.encode("utf-8")).hexdigest(),
                 "mtime": note.get("mtime", 0)},
    })
    target_dir = Path(output_dir).resolve()
    target_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    export_dir = Path(tempfile.mkdtemp(prefix="export-", dir=target_dir))
    markdown_path = export_dir / note["path"]
    markdown_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    manifest_path = export_dir / "manifest.json"
    for path, value in ((markdown_path, content), (manifest_path, json.dumps(manifest, ensure_ascii=False, indent=2))):
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            stream.write(value)
    return str(manifest_path)


def main() -> int:
    parser = argparse.ArgumentParser(description="Export one authorized Fast Note Sync note")
    parser.add_argument("--base-url", default=os.getenv("FNS_BASE_URL", "http://127.0.0.1:9000"))
    parser.add_argument("--client", default=os.getenv("FNS_CLIENT", "transfer-bridge"))
    parser.add_argument("--allow-insecure-http", action="store_true")
    parser.add_argument("--vault", required=True)
    parser.add_argument("--path", required=True)
    parser.add_argument("--output-dir", default=os.getenv("TRANSFER_STAGING_DIR", ".transfer-staging"))
    args = parser.parse_args()
    try:
        note = fetch_note(args.base_url, os.getenv("FNS_AUTH_TOKEN", ""), args.vault, args.path,
                          args.client, args.allow_insecure_http)
        print(write_manifest(note, args.vault, args.output_dir))
    except (ValueError, OSError):
        parser.exit(2, "Export failed; check token/client permissions, note path, server connection and writable staging directory.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
