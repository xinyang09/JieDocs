#!/usr/bin/env bash

# Start a local Fast Note Sync Service instance without relying on the
# developer's checkout path.  The defaults work on macOS and Linux; set
# FNS_BIN, FNS_CONFIG, or FNS_LOG to override them for a custom install.
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BIN_PATH="${FNS_BIN:-${SCRIPT_DIR}/fast-note-sync-service}"
CONFIG_PATH="${FNS_CONFIG:-${SCRIPT_DIR}/config/config.yaml}"
LOG_PATH="${FNS_LOG:-${TMPDIR:-/tmp}/fns-fast-note-sync-service.log}"

# When no explicit binary is supplied, use the architecture-specific build
# output before falling back to the old development location in /tmp.
if [[ -z "${FNS_BIN:-}" && ! -x "$BIN_PATH" ]]; then
    case "$(uname -s):$(uname -m)" in
        Darwin:arm64) candidate="${SCRIPT_DIR}/build/darwin_arm64/fast-note-sync-service" ;;
        Darwin:x86_64) candidate="${SCRIPT_DIR}/build/darwin_amd64/fast-note-sync-service" ;;
        Linux:aarch64|Linux:arm64) candidate="${SCRIPT_DIR}/build/linux_arm64/fast-note-sync-service" ;;
        Linux:x86_64) candidate="${SCRIPT_DIR}/build/linux_amd64/fast-note-sync-service" ;;
        *) candidate="" ;;
    esac
    if [[ -n "$candidate" && -x "$candidate" ]]; then
        BIN_PATH="$candidate"
    elif [[ -x /tmp/fast-note-sync-service ]]; then
        BIN_PATH=/tmp/fast-note-sync-service
    fi
fi

if [[ ! -x "$BIN_PATH" ]]; then
    echo "fast-note-sync-service binary not found or not executable: $BIN_PATH" >&2
    echo "Set FNS_BIN to the binary path or build it beside start.sh." >&2
    exit 1
fi
if [[ ! -f "$CONFIG_PATH" ]]; then
    echo "configuration file not found: $CONFIG_PATH" >&2
    echo "Set FNS_CONFIG to the config file path." >&2
    exit 1
fi

mkdir -p "$(dirname -- "$LOG_PATH")"
cd -- "$SCRIPT_DIR"
nohup "$BIN_PATH" run -c "$CONFIG_PATH" >>"$LOG_PATH" 2>&1 < /dev/null &
echo "fast-note-sync-service started (pid $!, log: $LOG_PATH)"
