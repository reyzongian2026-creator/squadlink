@echo off
setlocal
pushd "%~dp0" || exit /b 1
node -e "process.exit(Number(process.versions.node.split('.')[0]) < 22 ? 1 : 0)" >nul 2>&1
if errorlevel 1 (
  echo Instala Node.js 22 o posterior desde https://nodejs.org/ y vuelve a abrir Squadlink.
  pause
  exit /b 1
)
node launch.mjs %*
set "result=%errorlevel%"
popd
if not "%result%"=="0" pause
exit /b %result%
