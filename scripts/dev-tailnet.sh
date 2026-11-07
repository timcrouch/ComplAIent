#!/usr/bin/env bash
# Local development only: reach the running dev stack from other devices (a phone, a tablet)
# over Tailscale HTTPS, private to your tailnet. See docs/operations/local-development.md.
#
#   bash scripts/dev-tailnet.sh on    # publish the app and Keycloak on the tailnet
#   bash scripts/dev-tailnet.sh off   # back to localhost only
#
# Ports stay bound to 127.0.0.1: `tailscale serve` proxies to localhost. Keycloak is not
# restarted: the realm's Frontend URL changes, so users and their subjects stay the same.
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE=(docker compose --env-file .env -f infrastructure/docker/compose.yaml)
KEYCLOAK="$("${COMPOSE[@]}" ps -q keycloak)"
POSTGRES="$("${COMPOSE[@]}" ps -q postgres)"
[ -n "$KEYCLOAK" ] && [ -n "$POSTGRES" ] || {
  echo "The dev stack is not running: run pnpm infra:up first" >&2
  exit 1
}
KEYCLOAK_PORT="$(docker port "$KEYCLOAK" 8080/tcp | head -1)"
KEYCLOAK_PORT="${KEYCLOAK_PORT##*:}"
LOCAL_WEB=http://localhost:3000
LOCAL_ISSUER="http://localhost:$KEYCLOAK_PORT/realms/isms"

tailnet_host() {
  tailscale status --json | python3 -I -c \
    'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))'
}

# Runs kcadm in the Keycloak container with the container's own admin credentials, so no
# secret passes through this shell. Arguments: the realm Frontend URL ("" = none) and the
# extra web origin allowed for the isms-web client ("" = localhost only).
configure_keycloak() {
  docker exec -e FRONTEND="$1" -e EXTRA="$2" -e LOCAL="$LOCAL_WEB" "$KEYCLOAK" sh -c '
    set -e
    K=/opt/keycloak/bin/kcadm.sh
    $K config credentials --server http://localhost:8080 --realm master \
      --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" >/dev/null
    $K update realms/isms -s "attributes.frontendUrl=$FRONTEND"
    ID=$($K get clients -r isms -q clientId=isms-web --fields id --format csv --noquotes)
    if [ -n "$EXTRA" ]; then
      $K update "clients/$ID" -r isms \
        -s "redirectUris=[\"$LOCAL/auth/callback\",\"$EXTRA/auth/callback\"]" \
        -s "webOrigins=[\"$LOCAL\",\"$EXTRA\"]" \
        -s "attributes.\"post.logout.redirect.uris\"=$LOCAL/##$EXTRA/"
    else
      $K update "clients/$ID" -r isms \
        -s "redirectUris=[\"$LOCAL/auth/callback\"]" -s "webOrigins=[\"$LOCAL\"]" \
        -s "attributes.\"post.logout.redirect.uris\"=$LOCAL/"
    fi'
}

# The app keys users on (issuer, subject); the issuer changes with the Frontend URL, so move
# existing sign-ins to the new issuer instead of creating second users without roles.
move_issuer() {
  docker exec -e FROM="$1" -e TO="$2" "$POSTGRES" sh -c \
    'psql -U "$POSTGRES_USER" -d isms -v ON_ERROR_STOP=1 -v from="$FROM" -v to="$TO" -Atq' <<'SQL'
UPDATE "User" SET "idpIssuer" = :'to' WHERE "idpIssuer" = :'from';
SQL
}

case "${1:-}" in
  on)
    tailscale status >/dev/null 2>&1 || tailscale up
    HOST="$(tailnet_host)"
    tailscale serve --bg --https=443 "$LOCAL_WEB" >/dev/null
    tailscale serve --bg --https=8443 "http://localhost:$KEYCLOAK_PORT" >/dev/null
    configure_keycloak "https://$HOST:8443" "https://$HOST"
    move_issuer "$LOCAL_ISSUER" "https://$HOST:8443/realms/isms"
    cat <<EOF

Tailnet access is on. Restart the app with:

  WEB_BASE_URL=https://$HOST \\
  OIDC_ISSUER_URL=https://$HOST:8443/realms/isms \\
  DEV_ALLOWED_ORIGINS=$HOST \\
  pnpm dev

(add DEMO_TOOLS_ENABLED=true BOOTSTRAP_ADMIN_EMAIL=admin@example.test for demo mode)
Then open https://$HOST on any device signed in to your tailnet.
EOF
    ;;
  off)
    HOST="$(tailnet_host)"
    tailscale serve --https=443 off >/dev/null 2>&1 || true
    tailscale serve --https=8443 off >/dev/null 2>&1 || true
    configure_keycloak "" ""
    move_issuer "https://$HOST:8443/realms/isms" "$LOCAL_ISSUER"
    echo "Tailnet access is off. Restart pnpm dev without the tailnet variables."
    ;;
  *)
    echo "usage: bash scripts/dev-tailnet.sh on|off" >&2
    exit 2
    ;;
esac
