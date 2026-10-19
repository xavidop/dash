@echo off
setlocal
rem ───────────────────────────────────────────────────────────────
rem  Dash: start the server and open Edge in fullscreen kiosk mode.
rem  Usage: start.bat           (normal)
rem         start.bat demo      (simulated live games)
rem ───────────────────────────────────────────────────────────────
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install it with nvm-windows: nvm install latest ^&^& nvm use latest
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install || exit /b 1
)
if not exist web\dist\index.html (
  echo Building the frontend...
  call npm run build || exit /b 1
)

rem Keep the screen and the machine awake while plugged in.
powercfg /change monitor-timeout-ac 0 >nul 2>nul
powercfg /change standby-timeout-ac 0 >nul 2>nul
powercfg /change hibernate-timeout-ac 0 >nul 2>nul

set DASH_ARGS=
if /i "%1"=="demo" set DASH_ARGS=--demo

rem Start the server in its own minimized window (logs go to data\server.log).
rem server\supervise.js restarts it automatically if it ever crashes or runs out of memory.
if not exist data mkdir data
start "Dash server" /min cmd /c "node server\supervise.js %DASH_ARGS% >> data\server.log 2>&1"

rem Wait until the server answers (max ~60s).
powershell -NoProfile -Command "$i=0; while ($i -lt 60) { try { Invoke-WebRequest -UseBasicParsing http://localhost:3000/api/state -TimeoutSec 2 | Out-Null; exit 0 } catch { Start-Sleep 1; $i++ } }; exit 1"

rem Fullscreen kiosk. Overscroll navigation and pinch zoom are disabled so swipes stay inside Dash.
set EDGE_ARGS=--kiosk http://localhost:3000 --edge-kiosk-type=fullscreen --no-first-run --disable-pinch --overscroll-history-navigation=0 --disable-features=OverscrollHistoryNavigation,Translate --autoplay-policy=no-user-gesture-required
start "" msedge %EDGE_ARGS%

rem Keep the kiosk alive: if Edge is closed or crashes, open it again (checked every minute).
:watch
timeout /t 60 /nobreak >nul
tasklist /fi "imagename eq msedge.exe" | find /i "msedge.exe" >nul || start "" msedge %EDGE_ARGS%
goto watch

