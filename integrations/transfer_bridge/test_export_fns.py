import hashlib
import tempfile
import unittest
from pathlib import Path

from integrations.transfer_bridge.export_fns import write_manifest


class ExportTest(unittest.TestCase):
    def test_write_manifest_preserves_empty_markdown(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest = Path(write_manifest({"path": "empty.md", "content": "", "mtime": 1,
                                            "source": {"server": "https://fns.example.test", "uid": 7}}, "demo", directory))
            self.assertEqual((manifest.parent / "empty.md").read_text(), "")
            self.assertEqual(manifest.parent.joinpath("manifest.json").exists(), True)
            self.assertEqual(
                __import__("json").loads(manifest.read_text())["note"]["content_sha256"],
                hashlib.sha256(b"").hexdigest(),
            )

    def test_write_manifest_rejects_path_escape(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "relative"):
                write_manifest({"path": "../outside.md", "content": "x",
                                "source": {"server": "https://fns.example.test", "uid": 7}}, "demo", directory)


if __name__ == "__main__":
    unittest.main()
