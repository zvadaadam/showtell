#!/bin/sh
# agent-video installer (macOS).
#
#   curl -fsSL https://raw.githubusercontent.com/zvadaadam/agent-video/main/scripts/install.sh | sh
#
# Options via env vars:
#   AGENT_VIDEO_VERSION      install a specific tag (default: latest release)
#   AGENT_VIDEO_INSTALL_DIR  binary directory (default: ~/.local/bin)
#   AGENT_VIDEO_SKILL_DIR    skill directory (default: ~/.claude/skills; set to "skip" to skip)
set -eu

REPO="zvadaadam/agent-video"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "agent-video v0.x supports macOS only (local 'say' TTS + AVFoundation capture)." >&2
  exit 1
fi

case "$(uname -m)" in
  arm64) TARGET="darwin-arm64" ;;
  x86_64) TARGET="darwin-x64" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

VERSION="${AGENT_VIDEO_VERSION:-}"
if [ -z "$VERSION" ]; then
  VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)
fi
if [ -z "$VERSION" ]; then
  echo "Could not resolve the latest release. Set AGENT_VIDEO_VERSION=vX.Y.Z and retry." >&2
  exit 1
fi

BASE="https://github.com/$REPO/releases/download/$VERSION"
BIN_TAR="agent-video-$VERSION-$TARGET.tar.gz"
SKILL_TAR="agent-video-skill-$VERSION.tar.gz"
INSTALL_DIR="${AGENT_VIDEO_INSTALL_DIR:-$HOME/.local/bin}"
SKILL_DIR="${AGENT_VIDEO_SKILL_DIR:-$HOME/.claude/skills}"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "Downloading agent-video $VERSION ($TARGET)..."
curl -fsSL -o "$WORK/$BIN_TAR" "$BASE/$BIN_TAR"
curl -fsSL -o "$WORK/SHA256SUMS" "$BASE/SHA256SUMS"

EXPECTED=$(grep " $BIN_TAR\$" "$WORK/SHA256SUMS" | awk '{print $1}')
ACTUAL=$(shasum -a 256 "$WORK/$BIN_TAR" | awk '{print $1}')
if [ -z "$EXPECTED" ] || [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "Checksum mismatch for $BIN_TAR — aborting." >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"
tar -xzf "$WORK/$BIN_TAR" -C "$INSTALL_DIR"
chmod +x "$INSTALL_DIR/agent-video"
echo "Installed $INSTALL_DIR/agent-video"

if [ "$SKILL_DIR" != "skip" ]; then
  if curl -fsSL -o "$WORK/$SKILL_TAR" "$BASE/$SKILL_TAR" 2>/dev/null; then
    SKILL_EXPECTED=$(grep " $SKILL_TAR\$" "$WORK/SHA256SUMS" | awk '{print $1}')
    SKILL_ACTUAL=$(shasum -a 256 "$WORK/$SKILL_TAR" | awk '{print $1}')
    if [ -n "$SKILL_EXPECTED" ] && [ "$SKILL_EXPECTED" = "$SKILL_ACTUAL" ]; then
      mkdir -p "$SKILL_DIR"
      tar -xzf "$WORK/$SKILL_TAR" -C "$SKILL_DIR"
      echo "Installed skill to $SKILL_DIR/agent-video (Claude Code picks it up automatically)"
    else
      echo "Skipped skill install: checksum mismatch." >&2
    fi
  fi
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo ""
  echo "ffmpeg is required to render videos:  brew install ffmpeg"
fi

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) echo "Add to PATH:  export PATH=\"$INSTALL_DIR:\$PATH\"" ;;
esac

echo ""
"$INSTALL_DIR/agent-video" version
