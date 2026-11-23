#!/bin/sh
# Run directly on an existing OCI VM. Checks only non-secret instance metadata.
set -eu
if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
  echo 'Uso: sh ops/santiago/start-relay.sh /ruta/privada/pilot.env' >&2
  exit 2
fi

region=$(curl --noproxy '*' --fail --silent --show-error --connect-timeout 2 --max-time 4 \
  -H 'Authorization: Bearer Oracle' \
  http://169.254.169.254/opc/v2/instance/canonicalRegionName) || {
  echo 'No se pudo verificar la región de la instancia OCI.' >&2
  exit 1
}
if [ "$region" != 'sa-santiago-1' ]; then
  echo 'Esta instancia no está en Chile Central (Santiago).' >&2
  exit 1
fi

ops_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
docker compose --env-file "$1" -f "$ops_dir/compose.yaml" config --quiet
docker compose --env-file "$1" -f "$ops_dir/compose.yaml" up -d --no-deps turn
echo 'Instancia OCI en sa-santiago-1. Verifica la asignación pública TURN desde las redes de los jugadores.'
