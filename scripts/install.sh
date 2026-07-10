#!/bin/sh
# showtell installer (macOS and Linux).
#
#   curl -fsSL https://raw.githubusercontent.com/zvadaadam/showtell/main/scripts/install.sh | sh
#
# Options via env vars:
#   SHOWTELL_VERSION      install a specific tag (default: latest release)
#   SHOWTELL_INSTALL_DIR  binary directory (default: ~/.local/bin)
#   SHOWTELL_SKILL_DIR    skill directory (default: ~/.claude/skills; set to "skip" to skip)
set -eu

REPO="zvadaadam/showtell"

OS=$(uname -s)
ARCH=$(uname -m)
case "$OS-$ARCH" in
  Darwin-arm64) TARGET="darwin-arm64" ;;
  Linux-x86_64) TARGET="linux-x64" ;;
  Linux-aarch64|Linux-arm64) TARGET="linux-arm64" ;;
  *)
    echo "showtell supports Apple Silicon macOS and glibc-based Linux on x64 or ARM64." >&2
    exit 1
    ;;
esac

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

VERSION="${SHOWTELL_VERSION:-}"
if [ -z "$VERSION" ]; then
  VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)
fi
if [ -z "$VERSION" ]; then
  echo "Could not resolve the latest release. Set SHOWTELL_VERSION=vX.Y.Z and retry." >&2
  exit 1
fi

BASE="https://github.com/$REPO/releases/download/$VERSION"
BIN_TAR="showtell-$VERSION-$TARGET.tar.gz"
SKILL_TAR="showtell-skill-$VERSION.tar.gz"
INSTALL_DIR="${SHOWTELL_INSTALL_DIR:-$HOME/.local/bin}"
SKILL_DIR="${SHOWTELL_SKILL_DIR:-$HOME/.claude/skills}"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "Downloading showtell $VERSION ($TARGET)..."
curl -fsSL -o "$WORK/$BIN_TAR" "$BASE/$BIN_TAR"
curl -fsSL -o "$WORK/SHA256SUMS" "$BASE/SHA256SUMS"

EXPECTED=$(grep " $BIN_TAR\$" "$WORK/SHA256SUMS" | awk '{print $1}')
ACTUAL=$(hash_file "$WORK/$BIN_TAR")
if [ -z "$EXPECTED" ] || [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "Checksum mismatch for $BIN_TAR — aborting." >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"
tar -xzf "$WORK/$BIN_TAR" -C "$INSTALL_DIR"
chmod +x "$INSTALL_DIR/showtell"
echo "Installed $INSTALL_DIR/showtell"

if [ "$SKILL_DIR" != "skip" ]; then
  if curl -fsSL -o "$WORK/$SKILL_TAR" "$BASE/$SKILL_TAR" 2>/dev/null; then
    SKILL_EXPECTED=$(grep " $SKILL_TAR\$" "$WORK/SHA256SUMS" | awk '{print $1}')
    SKILL_ACTUAL=$(hash_file "$WORK/$SKILL_TAR")
    if [ -n "$SKILL_EXPECTED" ] && [ "$SKILL_EXPECTED" = "$SKILL_ACTUAL" ]; then
      mkdir -p "$SKILL_DIR"
      tar -xzf "$WORK/$SKILL_TAR" -C "$SKILL_DIR"
      echo "Installed skill to $SKILL_DIR/showtell (Claude Code picks it up automatically)"
    else
      echo "Skipped skill install: checksum mismatch." >&2
    fi
  fi
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo ""
  if [ "$OS" = "Darwin" ]; then
    echo "ffmpeg is required to render videos:  brew install ffmpeg"
  else
    echo "ffmpeg is required to render videos:  sudo apt-get install ffmpeg"
  fi
fi
if [ "$OS" = "Linux" ] && ! command -v espeak-ng >/dev/null 2>&1 && ! command -v espeak >/dev/null 2>&1; then
  echo "espeak-ng is required for local narration:  sudo apt-get install espeak-ng"
fi

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) echo "Add to PATH:  export PATH=\"$INSTALL_DIR:\$PATH\"" ;;
esac

echo ""
"$INSTALL_DIR/showtell" version
