import hashlib
import importlib.util
import json
import logging
import os
import re
from pathlib import Path


class BridgeError(RuntimeError):
    def __init__(self, message: str, code: str = "rejected", external_id: str = ""):
        super().__init__(message)
        self.code = code
        self.external_id = external_id


def _required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise BridgeError(f"missing environment variable: {name}")
    return value


def _identifier(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value):
        raise BridgeError("provider returned or received an invalid document identifier")
    return value


class TransferProvider:
    @staticmethod
    def destination(provider: str) -> list[str]:
        if provider == "notion":
            return [provider, os.getenv("TRANSFER_NOTION_PARENT_ID", "")]
        return [provider, os.getenv("TRANSFER_FEISHU_APP_ID", ""), os.getenv("TRANSFER_FEISHU_FOLDER_TOKEN", "")]

    def __init__(self, provider: str, project_path: str):
        if provider not in {"notion", "feishu"}:
            raise BridgeError("unsupported provider")
        if not project_path:
            raise BridgeError("TRANSFER_PROJECT_PATH is required for live publishing")
        filename = Path(project_path).resolve() / "src" / f"{provider}_client.py"
        if not filename.is_file():
            raise BridgeError("transfer checkout is missing the expected provider module")
        module_name = "_fns_transfer_" + hashlib.sha256(str(filename).encode()).hexdigest()
        spec = importlib.util.spec_from_file_location(module_name, filename)
        if spec is None or spec.loader is None:
            raise BridgeError("cannot load the transfer provider module")
        self.module = importlib.util.module_from_spec(spec)
        logging.getLogger(module_name).disabled = True
        try:
            spec.loader.exec_module(self.module)
        except ImportError:
            raise BridgeError("install the external transfer checkout's dependencies in this Python environment") from None
        self.provider = provider
        if provider == "feishu":
            self.client = self.module.FeishuClient(
                _required("TRANSFER_FEISHU_APP_ID"), _required("TRANSFER_FEISHU_APP_SECRET"),
                os.getenv("TRANSFER_FEISHU_USER_ACCESS_TOKEN") or None,
            )
            self.parent = os.getenv("TRANSFER_FEISHU_FOLDER_TOKEN", "")
            if self.parent:
                _identifier(self.parent)
        else:
            self.parent = _identifier(_required("TRANSFER_NOTION_PARENT_ID"))
            self.client = self.module.NotionClient(_required("TRANSFER_NOTION_API_KEY"))
        self.blocks = []

    def prepare(self, title: str, content: str) -> None:
        self.title = title
        if len(title) > 255:
            raise BridgeError("document title exceeds 255 characters")
        if self.provider == "feishu":
            self.blocks = self.client._markdown_to_docx_blocks(content)
        else:
            self.blocks = self.module.markdown_to_notion_blocks(content)
            for block in self.blocks:
                payload = block.get(block.get("type"), {})
                rich_text = []
                for item in payload.get("rich_text", []):
                    text = item.get("text", {}).get("content", "")
                    if text:
                        for offset in range(0, len(text), 1000):
                            rich_text.append({**item, "text": {**item["text"], "content": text[offset:offset + 1000]}})
                if len(rich_text) > 100:
                    raise BridgeError("a Notion block exceeds the MVP rich-text limit")
                if "rich_text" in payload:
                    payload["rich_text"] = rich_text
        if not isinstance(self.blocks, list) or len(self.blocks) > 1000:
            raise BridgeError("document exceeds the 1000-block MVP limit")
        if content.strip() and not self.blocks:
            raise BridgeError("the upstream converter produced no content")
        if len(json.dumps(self.blocks, ensure_ascii=False).encode("utf-8")) > 400_000:
            raise BridgeError("converted document exceeds the 400 KB MVP limit")

    def _request(self, method: str, path: str, body: dict) -> dict:
        if self.provider == "feishu":
            base_url = "https://open.feishu.cn/open-apis"
            headers = self.client._get_headers()
        else:
            base_url = "https://api.notion.com/v1"
            headers = self.client.headers
        response = self.module.requests.request(
            method, base_url + path, headers=headers, json=body, timeout=30, allow_redirects=False,
        )
        if response.status_code < 200 or response.status_code >= 300:
            raise BridgeError("provider HTTP request failed")
        result = response.json()
        if not isinstance(result, dict):
            raise BridgeError("invalid provider response")
        if self.provider == "feishu" and (result.get("code") != 0 or not isinstance(result.get("data"), dict)):
            raise BridgeError("Feishu rejected the request")
        return result

    def create(self, on_created) -> tuple[str, str]:
        if self.provider == "feishu":
            body = {"title": self.title}
            if self.parent:
                body["folder_token"] = self.parent
            result = self._request("POST", "/docx/v1/documents", body)
            external_id = _identifier(result["data"].get("document", {}).get("document_id"))
            external_url = ""
            on_created(external_id, external_url)
            for offset in range(0, len(self.blocks), 50):
                batch = self.blocks[offset:offset + 50]
                result = self._request(
                    "POST", f"/docx/v1/documents/{external_id}/blocks/{external_id}/children",
                    {"children": batch, "index": offset},
                )
                if len(result["data"].get("children", [])) != len(batch):
                    raise BridgeError("Feishu returned an incomplete content batch")
        else:
            result = self._request("POST", "/pages", {
                "parent": {"type": "page_id", "page_id": self.parent},
                "properties": {"title": {"title": [{"type": "text", "text": {"content": self.title}}]}},
                "children": self.blocks[:100],
            })
            external_id = _identifier(result.get("id"))
            external_url = f"https://www.notion.so/{external_id.replace('-', '')}"
            on_created(external_id, external_url)
            for offset in range(100, len(self.blocks), 100):
                batch = self.blocks[offset:offset + 100]
                result = self._request("PATCH", f"/blocks/{external_id}/children", {"children": batch})
                if len(result.get("results", [])) != len(batch):
                    raise BridgeError("Notion returned an incomplete content batch")
        return external_id, external_url
