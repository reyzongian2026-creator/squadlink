@echo off
setlocal
pushd "%~dp0" || exit /b 1
dotnet publish Squadlink.csproj -c Release -r win-x64 --self-contained true -o ..\artifacts\Squadlink-win-x64
if errorlevel 1 (
  echo Requiere .NET 10 SDK y acceso a NuGet para compilar.
  pause
  exit /b 1
)
echo Cliente listo en artifacts\Squadlink-win-x64. Distribuye la carpeta completa.
popd
pause
