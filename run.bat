@echo off
setlocal
title OpenFishTools Studio - Live Server + Cloudflare Public Link
cd /d "%~dp0"

echo ===================================================
echo   OpenFishTools Studio
echo   Local Server  : http://localhost:3000
echo   Public Tunnel : Cloudflare (trycloudflare.com)
echo ===================================================
echo.

if not exist "cloudflared.exe" (
  where cloudflared >nul 2>nul
  if %ERRORLEVEL% neq 0 (
    echo [Info] Mendownload cloudflared.exe resmi dari Cloudflare...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe'"
    if exist "cloudflared.exe" (
      echo [OK] cloudflared.exe berhasil didownload!
    ) else (
      echo [Warning] Gagal mendownload cloudflared.exe. Server tetap berjalan di localhost.
    )
    echo.
  )
)

node server.js --tunnel
if %ERRORLEVEL% neq 0 (
  echo.
  echo [Info] Menjalankan via npm run tunnel...
  call npm run tunnel
)
pause
