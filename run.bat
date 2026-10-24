@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is needed to run 7 Views. Install the LTS version from https://nodejs.org, then run this again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing 7 Views, this takes a minute the first time...
  call npm install
  if errorlevel 1 (
    echo Install failed. Scroll up for the error.
    pause
    exit /b 1
  )
)
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0"
