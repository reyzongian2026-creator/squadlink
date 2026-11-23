#!/bin/sh
cd "$(dirname "$0")" || exit 1
# Finder puede abrir Terminal sin las rutas de Homebrew.
PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
export PATH
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) < 22 ? 1 : 0)'; then
  echo "Instala Node.js 22 o posterior desde https://nodejs.org/ y vuelve a abrir Squadlink."
  exit 1
fi
exec node launch.mjs "$@"
