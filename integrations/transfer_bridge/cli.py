import argparse
import json
import os
import sqlite3

from .publisher import Bridge, BridgeError
from .store import BridgeStore


def main() -> int:
    parser = argparse.ArgumentParser(description="Safe create-only adapter for sepao/transfer")
    parser.add_argument("--db", default=os.getenv("TRANSFER_STATE_DB", ".transfer-state/bridge.sqlite3"))
    parser.add_argument("--profile", default=os.getenv("TRANSFER_PROFILE", "default"))
    parser.add_argument("--json-errors", action="store_true")
    subparsers = parser.add_subparsers(dest="command", required=True)
    publish = subparsers.add_parser("publish")
    publish.add_argument("manifest")
    publish.add_argument("--provider", choices=("feishu", "notion"), required=True)
    publish.add_argument("--live", action="store_true", help="create a real external document")
    publish.add_argument("--force", action="store_true", help="create a new revision for changed content")
    history = subparsers.add_parser("history")
    history.add_argument("--limit", type=int, default=50)
    args = parser.parse_args()
    store = None
    try:
        store = BridgeStore(args.db)
        if args.command == "history":
            print(json.dumps(store.list_history(args.limit), ensure_ascii=False, indent=2))
            return 0
        result = Bridge(store, profile=args.profile).publish(args.manifest, args.provider, dry_run=not args.live, force=args.force)
        print(json.dumps(result.__dict__, ensure_ascii=False, indent=2))
        return 0
    except (BridgeError, ValueError) as error:
        if args.json_errors:
            print(json.dumps({"status": getattr(error, "code", "rejected"),
                              "external_id": getattr(error, "external_id", ""),
                              "error": "publication requires attention; inspect configuration or bridge history"}))
            return 2
        parser.error(str(error))
    except (OSError, sqlite3.Error):
        if args.json_errors:
            print(json.dumps({"status": "uncertain", "external_id": "", "error": "bridge storage unavailable"}))
            return 2
        parser.exit(2, "Bridge storage failed; check manifest/database paths and permissions.\n")
    finally:
        if store is not None:
            store.close()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
