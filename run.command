#!/usr/bin/env bash
# ===================================================
#   FishTools Studio - macOS Server Launcher
# ===================================================

# Target FishTools Studio (wasm) if available
WASM_DIR="$(dirname "$0")/../FishTools Studio (wasm)"
if [ -d "$WASM_DIR" ]; then
  cd "$WASM_DIR" || exit 1
else
  cd "$(dirname "$0")" || exit 1
fi

# Ensure Node and common package manager paths are available in GUI / Terminal session
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

if [ -d "$HOME/.nvm" ]; then
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" --no-use 2>/dev/null
fi

# Terminate any stale server instance on port 3000
OLD_PID=$(lsof -ti :3000 2>/dev/null)
if [ -n "$OLD_PID" ]; then
  kill -9 $OLD_PID 2>/dev/null
  sleep 0.4
fi

# Build WebAssembly binary if missing
if [ ! -f "assets/wasm/fishtools-core.wasm" ]; then
  echo "[WASM] Mengompilasi modul WebAssembly..."
  npm run build:wasm
fi

clear
echo "  OpenFishTools Studio (WASM Core Accelerated)"
echo "  Core Engine   : WebAssembly High-Performance 3D Matrix & Perspective"
echo "  Local Server  : http://localhost:3000"
echo "  Desktop Route : http://localhost:3000/desktop"
echo "  Editor Route  : http://localhost:3000/editor"
echo "==================================================="
echo ""

# Check Node.js installation
if ! command -v node >/dev/null 2>&1; then
  echo "[Error] Node.js tidak ditemukan di sistem."
  echo "Silakan install Node.js dari https://nodejs.org/ atau via Homebrew ('brew install node')."
  echo ""
  read -p "Tekan Enter untuk keluar..."
  exit 1
fi

# Detect architecture for optional cloudflared binary
ARCH=$(uname -m)
if [ ! -f "cloudflared" ] && ! command -v cloudflared >/dev/null 2>&1; then
  echo "[Info] cloudflared tidak ditemukan. Mencoba download untuk macOS ($ARCH)..."
  CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64"
  if [ "$ARCH" = "arm64" ]; then
    CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64"
  fi

  if curl -fsSL -m 15 "$CF_URL" -o "cloudflared" 2>/dev/null; then
    chmod +x "cloudflared"
    echo "[OK] cloudflared berhasil didownload!"
  else
    rm -f "cloudflared"
    echo "[Info] Lewati cloudflared (server tetap berjalan di http://localhost:3000)."
  fi
  echo ""
fi

# Open default browser after server initializes in background
(
  sleep 1.2
  if command -v open >/dev/null 2>&1; then
    open "http://localhost:3000" 2>/dev/null
  fi
) &

# Run server
echo "[Starting] Menjalankan server..."
node server.js --tunnel || node server.js
