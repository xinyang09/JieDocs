import json
import hashlib
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from integrations.transfer_bridge.publisher import Bridge, BridgeError
from integrations.transfer_bridge.store import BridgeStore


def write_manifest(directory: str, content: str = "# Hello") -> str:
    path = Path(directory) / "manifest.json"
    import hashlib

    path.write_text(
        json.dumps(
            {
                "version": 1,
                "source": {"server": "https://fns.example.test", "uid": 7},
                "vault": "demo",
                "note": {
                    "path": "docs/hello.md",
                    "content": content,
                    "content_sha256": hashlib.sha256(content.encode()).hexdigest(),
                },
            }
        ),
        encoding="utf-8",
    )
    return str(path)


class BridgeTest(unittest.TestCase):
    def test_dry_run_does_not_create_mapping_or_load_provider(self):
        with tempfile.TemporaryDirectory() as directory:
            store = BridgeStore(":memory:")
            result = Bridge(store).publish(write_manifest(directory), "feishu")

            self.assertEqual(result.status, "dry-run")
            self.assertEqual(result.external_id, "")
            self.assertIsNone(store.get_mapping(("scope", "feishu", "demo", "docs/hello.md")))
            self.assertEqual(store.list_history()[0]["status"], "dry-run")
            store.close()

    def test_same_content_is_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            store = BridgeStore(":memory:")
            content_hash = hashlib.sha256(b"# Hello").hexdigest()
            key = ("scope", "notion", "demo", "docs/hello.md")
            self.assertEqual(store.reserve(key, content_hash, False)[0], "creating")
            store.mark(key, "created", "page-1", "https://notion.so/page-1")
            second, current = store.reserve(key, content_hash, False)

            self.assertEqual(second, "unchanged")
            self.assertEqual(current["external_id"], "page-1")
            store.close()


    @patch("integrations.transfer_bridge.publisher.TransferProvider")
    def test_fake_live_publish_records_external_id_and_conflict(self, provider_class):
        provider_class.destination.return_value = ["feishu", "folder"]
        provider = provider_class.return_value
        provider.prepare.return_value = None
        provider.create.return_value = ("doc-1", "https://example.test/doc-1")
        with tempfile.TemporaryDirectory() as directory:
            store = BridgeStore(":memory:")
            first = Bridge(store).publish(write_manifest(directory, "old"), "feishu", dry_run=False)
            self.assertEqual(first.status, "created")
            self.assertEqual(first.external_id, "doc-1")
            with self.assertRaises(BridgeError) as raised:
                Bridge(store).publish(write_manifest(directory, "new"), "feishu", dry_run=False)
            self.assertEqual(raised.exception.code, "conflict")
            store.close()

    def test_cli_json_error_is_machine_readable(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest = Path(directory) / "invalid.json"
            manifest.write_text("{}", encoding="utf-8")
            process = subprocess.run(
                [sys.executable, "-m", "integrations.transfer_bridge", "--json-errors", "publish",
                 str(manifest), "--provider", "feishu"],
                capture_output=True, text=True, check=False,
            )
            self.assertEqual(process.returncode, 2)
            self.assertEqual(process.stderr, "")
            payload = json.loads(process.stdout)
            self.assertEqual(payload["status"], "rejected")
            self.assertNotIn("invalid.json", process.stdout)

    def test_changed_content_requires_force(self):
        with tempfile.TemporaryDirectory() as directory:
            store = BridgeStore(":memory:")
            old_hash = hashlib.sha256(b"old").hexdigest()
            new_hash = hashlib.sha256(b"new").hexdigest()
            key = ("scope", "feishu", "demo", "docs/hello.md")
            self.assertEqual(store.reserve(key, old_hash, False)[0], "creating")
            store.mark(key, "created", "doc-1")

            status, current = store.reserve(key, new_hash, False)
            self.assertEqual(status, "conflict")
            self.assertEqual(current["external_id"], "doc-1")
            self.assertEqual(store.list_history()[0]["status"], "conflict")
            store.close()


if __name__ == "__main__":
    unittest.main()
