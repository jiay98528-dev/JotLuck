#!/usr/bin/env bash
# Build unsigned Linux preview packages from the current JotLuck tree.
# Default: HEAD, .deb required, AppImage optional, window smoke when DISPLAY is set.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SKIP_SMOKE=0
SKIP_APPIMAGE=0
REQUIRE_CLEAN=0
DO_INSTALL=0
EXPECT_COMMIT=""
SMOKE_SECONDS=12

usage() {
  cat <<'EOF'
Usage: scripts/release/linux-preview-pack.sh [options]

  --commit <sha>     Require HEAD to match this commit
  --require-clean    Fail if the worktree is dirty
  --skip-appimage    Build only the .deb
  --skip-smoke       Do not launch the built binary
  --install          sudo dpkg -i the .deb after a successful build
  --help             Show this help

Does not git push, tag, or publish. Writes a receipt next to the bundles.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --commit)
      EXPECT_COMMIT="${2:?}"
      shift 2
      ;;
    --require-clean) REQUIRE_CLEAN=1; shift ;;
    --skip-appimage) SKIP_APPIMAGE=1; shift ;;
    --skip-smoke) SKIP_SMOKE=1; shift ;;
    --install) DO_INSTALL=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

cd "$ROOT"

git_rev="$(git rev-parse HEAD)"
if [[ -n "$EXPECT_COMMIT" ]]; then
  got="$(git rev-parse --verify "$EXPECT_COMMIT")"
  if [[ "$git_rev" != "$got" ]]; then
    echo "HEAD $git_rev does not match --commit $got" >&2
    exit 1
  fi
fi
if [[ "$REQUIRE_CLEAN" -eq 1 ]] && [[ -n "$(git status --porcelain)" ]]; then
  echo "worktree is dirty; pass without --require-clean to pack anyway" >&2
  git status --porcelain >&2
  exit 1
fi

main_rs="packages/app/src-tauri/src/main.rs"
desktop_tpl="packages/app/src-tauri/installer-assets/linux/jotluck.desktop"
tauri_conf="packages/app/src-tauri/tauri.conf.json"

if ! grep -q 'WEBKIT_DISABLE_DMABUF_RENDERER' "$main_rs"; then
  echo "missing Linux WebKitGTK DMABUF workaround in $main_rs" >&2
  exit 1
fi
if [[ ! -f "$desktop_tpl" ]]; then
  echo "missing $desktop_tpl" >&2
  exit 1
fi
if ! grep -q 'Categories=Office;TextEditor;Utility;' "$desktop_tpl"; then
  echo "desktop template is missing Office/TextEditor categories" >&2
  exit 1
fi
if ! grep -q 'MimeType=text/markdown' "$desktop_tpl"; then
  echo "desktop template is missing markdown MimeType" >&2
  exit 1
fi
if grep -q '"fileAssociations"' "$tauri_conf"; then
  echo "tauri.conf.json must not set bundle.fileAssociations (Windows NSIS contract)" >&2
  exit 1
fi
if ! grep -q 'installer-assets/linux/jotluck.desktop' "$tauri_conf"; then
  echo "tauri.conf.json is missing linux.deb.desktopTemplate" >&2
  exit 1
fi

# V2.5 completion assets must exist in BOTH copies with identical SHA.
# 0.14.0 shipped a deb whose frontend dist had no /autocomplete-v25/ and the
# engine silently never loaded (factory fetch 404 -> null -> n-gram only).
v25_public_dir="packages/app/public/autocomplete-v25"
v25_resource_dir="packages/app/src-tauri/resources/autocomplete-v25"
for f in autocomplete-public.manifest.json model.q4.decoder.bin tokenizer.runtime.json; do
  for d in "$v25_public_dir" "$v25_resource_dir"; do
    if [[ ! -f "$d/$f" ]]; then
      echo "missing V2.5 asset: $d/$f" >&2
      exit 1
    fi
  done
  pub_sha="$(sha256sum "$v25_public_dir/$f" | cut -d' ' -f1)"
  res_sha="$(sha256sum "$v25_resource_dir/$f" | cut -d' ' -f1)"
  if [[ "$pub_sha" != "$res_sha" ]]; then
    echo "V2.5 asset SHA mismatch for $f: public=$pub_sha resources=$res_sha" >&2
    exit 1
  fi
done

version="$(python3 - <<'PY'
import json
from pathlib import Path
print(json.loads(Path("package.json").read_text(encoding="utf-8"))["version"])
PY
)"

export APPIMAGE_EXTRACT_AND_RUN=1
export CARGO_TERM_COLOR=always
if [[ -f "$HOME/.cargo/env" ]]; then
  # Non-interactive SSH does not load cargo.
  # shellcheck source=/dev/null
  source "$HOME/.cargo/env"
fi
pack_started="$(date +%s)"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required" >&2
  exit 1
fi
if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo is required (source \$HOME/.cargo/env)" >&2
  exit 1
fi

pnpm install --frozen-lockfile

bundles="deb"
if [[ "$SKIP_APPIMAGE" -eq 0 ]]; then
  bundles="deb,appimage"
fi

set +e
(
  cd packages/app
  cargo tauri build --bundles "$bundles"
)
build_status=$?
set -e

bundle_root="packages/app/src-tauri/target/release/bundle"
deb_path="$(find "$bundle_root/deb" -maxdepth 1 -name '*.deb' -type f | sort | tail -n 1 || true)"
appimage_path="$(find "$bundle_root/appimage" -maxdepth 1 -name '*.AppImage' -type f | sort | tail -n 1 || true)"
bin_path="packages/app/src-tauri/target/release/jotluck"

if [[ -z "$deb_path" || ! -f "$deb_path" ]]; then
  echo "required .deb was not produced (tauri exit $build_status)" >&2
  exit 1
fi
deb_mtime="$(stat -c %Y "$deb_path")"
if [[ "$deb_mtime" -lt "$pack_started" ]]; then
  echo "required .deb is older than this pack run: $deb_path" >&2
  exit 1
fi

appimage_status="missing"
if [[ -n "$appimage_path" && -f "$appimage_path" ]]; then
  appimage_status="ok"
elif [[ "$SKIP_APPIMAGE" -eq 1 ]]; then
  appimage_status="skipped"
  appimage_path=""
else
  echo "AppImage was not produced; continuing because .deb is the required artifact (tauri exit $build_status)" >&2
  appimage_status="failed"
  appimage_path=""
fi

sha256_of() {
  sha256sum -b "$1" | awk '{print $1}'
}

deb_sha="$(sha256_of "$deb_path")"
deb_bytes="$(wc -c < "$deb_path" | tr -d ' ')"
appimage_sha=""
appimage_bytes=""
if [[ -n "$appimage_path" ]]; then
  appimage_sha="$(sha256_of "$appimage_path")"
  appimage_bytes="$(wc -c < "$appimage_path" | tr -d ' ')"
fi

smoke_status="skipped"
smoke_detail=""
if [[ "$SKIP_SMOKE" -eq 1 ]]; then
  smoke_status="skipped"
elif [[ -z "${DISPLAY:-}" ]]; then
  smoke_status="skipped"
  smoke_detail="DISPLAY is unset"
elif [[ ! -x "$bin_path" ]]; then
  echo "built binary missing: $bin_path" >&2
  exit 1
else
  smoke_log="$(mktemp)"
  pkill -x jotluck >/dev/null 2>&1 || true
  env \
    DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}" \
    "$bin_path" >"$smoke_log" 2>&1 &
  smoke_pid=$!
  sleep "$SMOKE_SECONDS"
  mapped=0
  if command -v wmctrl >/dev/null 2>&1; then
    wmctrl -l 2>/dev/null | grep -qi jotluck && mapped=1 || true
  fi
  if [[ "$mapped" -eq 0 ]] && command -v xwininfo >/dev/null 2>&1; then
    xwininfo -root -tree 2>/dev/null | grep -qi jotluck && mapped=1 || true
  fi
  kill "$smoke_pid" >/dev/null 2>&1 || true
  wait "$smoke_pid" >/dev/null 2>&1 || true
  pkill -x jotluck >/dev/null 2>&1 || true
  pkill -f WebKitWebProcess >/dev/null 2>&1 || true
  if grep -q 'JotLuck Tauri backend initialized' "$smoke_log" && [[ "$mapped" -eq 1 ]]; then
    smoke_status="pass"
    smoke_detail="window mapped; backend initialized"
  elif grep -q 'JotLuck Tauri backend initialized' "$smoke_log"; then
    echo "smoke failed: backend initialized but no JotLuck window" >&2
    cat "$smoke_log" >&2
    rm -f "$smoke_log"
    exit 1
  else
    echo "smoke failed: backend did not initialize" >&2
    cat "$smoke_log" >&2
    rm -f "$smoke_log"
    exit 1
  fi
  rm -f "$smoke_log"
fi

host_os="$(. /etc/os-release 2>/dev/null && printf '%s' "${PRETTY_NAME:-unknown}" || uname -s)"
webkit_ver="$(dpkg-query -W -f '${Version}' libwebkit2gtk-4.1-0 2>/dev/null || echo unknown)"
built_at="$(date -Iseconds)"

receipt="$bundle_root/linux-preview-receipt.json"
export JOTLUCK_RECEIPT_PATH="$receipt"
export JOTLUCK_VERSION="$version"
export JOTLUCK_GIT_REV="$git_rev"
export JOTLUCK_BUILT_AT="$built_at"
export JOTLUCK_HOST_OS="$host_os"
export JOTLUCK_KERNEL="$(uname -r)"
export JOTLUCK_ARCH="$(uname -m)"
export JOTLUCK_WEBKIT="$webkit_ver"
export JOTLUCK_DEB_PATH="$deb_path"
export JOTLUCK_DEB_BYTES="$deb_bytes"
export JOTLUCK_DEB_SHA="$deb_sha"
export JOTLUCK_APPIMAGE_PATH="$appimage_path"
export JOTLUCK_APPIMAGE_BYTES="$appimage_bytes"
export JOTLUCK_APPIMAGE_SHA="$appimage_sha"
export JOTLUCK_APPIMAGE_STATUS="$appimage_status"
export JOTLUCK_SMOKE_STATUS="$smoke_status"
export JOTLUCK_SMOKE_DETAIL="$smoke_detail"

python3 <<'PY'
import json, os
from pathlib import Path

def optional_int(value):
    return int(value) if value else None

def optional_str(value):
    return value or None

receipt_path = Path(os.environ["JOTLUCK_RECEIPT_PATH"])
payload = {
    "schema": "jotluck.linux-preview-receipt.v1",
    "version": os.environ["JOTLUCK_VERSION"],
    "gitRev": os.environ["JOTLUCK_GIT_REV"],
    "builtAt": os.environ["JOTLUCK_BUILT_AT"],
    "host": {
        "os": os.environ["JOTLUCK_HOST_OS"],
        "kernel": os.environ["JOTLUCK_KERNEL"],
        "arch": os.environ["JOTLUCK_ARCH"],
        "webkit2gtk": os.environ["JOTLUCK_WEBKIT"],
    },
    "artifacts": {
        "deb": {
            "path": os.environ["JOTLUCK_DEB_PATH"],
            "bytes": int(os.environ["JOTLUCK_DEB_BYTES"]),
            "sha256": os.environ["JOTLUCK_DEB_SHA"],
            "status": "ok",
        },
        "appimage": {
            "path": optional_str(os.environ.get("JOTLUCK_APPIMAGE_PATH", "")),
            "bytes": optional_int(os.environ.get("JOTLUCK_APPIMAGE_BYTES", "")),
            "sha256": optional_str(os.environ.get("JOTLUCK_APPIMAGE_SHA", "")),
            "status": os.environ["JOTLUCK_APPIMAGE_STATUS"],
        },
    },
    "smoke": {
        "status": os.environ["JOTLUCK_SMOKE_STATUS"],
        "detail": os.environ.get("JOTLUCK_SMOKE_DETAIL", ""),
    },
    "published": False,
}
receipt_path.parent.mkdir(parents=True, exist_ok=True)
receipt_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
print(receipt_path)
PY

docs_copy="scripts/release/linux-preview-last-receipt.json"
cp "$receipt" "$docs_copy"

if [[ "$DO_INSTALL" -eq 1 ]]; then
  sudo dpkg -i "$deb_path"
fi

echo
echo "Linux preview pack complete"
echo "  version:  $version"
echo "  commit:   $git_rev"
echo "  deb:      $deb_path"
echo "  sha256:   $deb_sha"
echo "  appimage: $appimage_status ${appimage_path:-}"
echo "  smoke:    $smoke_status"
echo "  receipt:  $receipt"
echo "  published: no"
