#!/usr/bin/env bash
#
# Runs BodyView as a background service on macOS via launchd.
#
#   ./scripts/macos-service.sh install     build, install and start the service
#   ./scripts/macos-service.sh update      git pull, rebuild, restart
#   ./scripts/macos-service.sh restart     restart the service
#   ./scripts/macos-service.sh status      is it running, and on what port
#   ./scripts/macos-service.sh logs        tail the service log
#   ./scripts/macos-service.sh backup [dir] snapshot the SQLite database
#   ./scripts/macos-service.sh sql         open a sqlite3 shell on the database
#   ./scripts/macos-service.sh uninstall   stop and remove the service
#
# Installs a LaunchAgent (per-user, no sudo). It starts at login and is
# restarted automatically if it ever exits.

set -euo pipefail

LABEL="com.bodyview.server"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/bodyview"
DOMAIN="gui/$(id -u)"

PORT="${BODYVIEW_PORT:-8787}"
HOST="${BODYVIEW_HOST:-127.0.0.1}"
DB_FILE="${BODYVIEW_DB:-$HOME/Library/Application Support/BodyView/bodyview.db}"
TOKEN="${BODYVIEW_TOKEN:-}"

die() { printf '\033[31merror:\033[0m %s\n' "$1" >&2; exit 1; }
info() { printf '\033[36m==>\033[0m %s\n' "$1"; }
ok() { printf '\033[32m  ok\033[0m %s\n' "$1"; }

require_macos() {
  [ "$(uname -s)" = "Darwin" ] || die "this script is for macOS; on Linux use a systemd unit instead"
}

node_bin() {
  local bin
  bin="$(command -v node || true)"
  [ -n "$bin" ] || die "node not found on PATH — install it (brew install node) and retry"

  # The server stores data with Node's built-in SQLite. Testing that it loads
  # is exact, where a version-number comparison would be guesswork — and
  # without it an old Node installs cleanly, then crash-loops under launchd
  # with nothing but a silent restart every 10 seconds to show for it.
  if ! "$bin" -e 'require("node:sqlite")' >/dev/null 2>&1; then
    die "this node ($("$bin" --version)) has no usable node:sqlite — upgrade with 'brew upgrade node' (Node 22.5 or newer) and retry"
  fi
  # launchd starts with a minimal PATH, so the absolute path is baked into the
  # plist. Under nvm that path contains the version number and will break on
  # the next upgrade; warn rather than silently install something brittle.
  case "$bin" in
    *"/.nvm/"*)
      printf '\033[33mwarning:\033[0m node is managed by nvm (%s).\n' "$bin" >&2
      printf '         The service pins this exact path and will stop working when you\n' >&2
      printf '         change node versions. Consider `brew install node` for a stable path.\n\n' >&2
      ;;
  esac
  printf '%s' "$bin"
}

# The Mac app keeps its CLI inside the bundle, so `tailscale` is usually not on
# PATH even when Tailscale is installed and running. Say which case we're in
# rather than printing a command that will just say "command not found".
APP_CLI="/Applications/Tailscale.app/Contents/MacOS/Tailscale"

tailscale_hint() {
  if command -v tailscale >/dev/null 2>&1; then
    printf '  tailscale serve --bg http://127.0.0.1:%s\n' "$PORT"
    printf '  tailscale serve status    # prints the https://... address\n'
    printf '\n  (One-time, in the admin console at login.tailscale.com/admin/dns:\n'
    printf '   enable MagicDNS and HTTPS Certificates, or serve cannot get a cert.)\n'
  elif [ -x "$APP_CLI" ]; then
    printf '  Tailscale is installed, but its CLI lives inside the app bundle.\n'
    printf '  Link it once, then publish:\n\n'
    printf '  sudo ln -sfn "%s" /usr/local/bin/tailscale\n' "$APP_CLI"
    printf '  tailscale serve --bg http://127.0.0.1:%s\n' "$PORT"
  else
    printf '  Tailscale is not installed. It gives this Mac a real certificate\n'
    printf '  and lets your phone reach it from anywhere, without opening any\n'
    printf '  port to the internet:\n\n'
    printf '  Download it from https://tailscale.com/download/mac and sign in\n'
    printf '  (or: brew install --cask tailscale-app), then:\n\n'
    printf '  sudo ln -sfn "%s" /usr/local/bin/tailscale\n' "$APP_CLI"
    printf '  tailscale serve --bg http://127.0.0.1:%s\n' "$PORT"
  fi
}

build() {
  info "Building"
  ( cd "$REPO" && npm ci --silent && npm run build --silent )
  ok "dist/ is up to date"
}

write_plist() {
  local node_path="$1"
  mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR" "$(dirname "$DB_FILE")"
  cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>

  <key>ProgramArguments</key>
  <array>
    <string>$node_path</string>
    <string>$REPO/server/serve.mjs</string>
  </array>

  <key>WorkingDirectory</key>
  <string>$REPO</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key><string>$PORT</string>
    <key>HOST</key><string>$HOST</string>
    <key>ROOT</key><string>$REPO/dist</string>
    <key>BODYVIEW_DB</key><string>$DB_FILE</string>
    <key>BODYVIEW_TOKEN</key><string>$TOKEN</string>
    <key>NODE_ENV</key><string>production</string>
  </dict>

  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>

  <key>StandardOutPath</key><string>$LOG_DIR/server.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/server.log</string>
</dict>
</plist>
PLISTEOF
  ok "wrote $PLIST"
}

bootout_quiet() {
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
}

cmd_install() {
  require_macos
  local node_path
  node_path="$(node_bin)"
  build
  write_plist "$node_path"

  info "Starting the service"
  bootout_quiet
  launchctl bootstrap "$DOMAIN" "$PLIST"
  launchctl enable "$DOMAIN/$LABEL"

  sleep 1
  if curl -sf "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
    ok "serving on http://127.0.0.1:$PORT"
  else
    printf '\033[33mwarning:\033[0m no response on port %s yet — check: %s logs\n' \
      "$PORT" "$0" >&2
  fi

  printf '\nDatabase: %s\n' "$DB_FILE"
  printf '\nNext: give it HTTPS, so the app installs properly on your phone.\n\n'
  tailscale_hint
  printf '\nThen open that address on each device and, in Settings -> Sync,\nconnect it. Every device then shares this one database.\n'
  printf 'Full walkthrough: docs/SELF-HOSTING.md\n'
}

cmd_uninstall() {
  require_macos
  info "Stopping and removing the service"
  bootout_quiet
  rm -f "$PLIST"
  ok "removed — your database at $DB_FILE is untouched"
}

# Backing up the database needs SQLite's own backup command: copying the file
# while the server is writing can capture a torn WAL.
cmd_backup() {
  require_macos
  local dest="${2:-$HOME/Library/Application Support/BodyView/backups}"
  mkdir -p "$dest"
  local target="$dest/bodyview-$(date +%Y%m%d-%H%M%S).db"
  sqlite3 "$DB_FILE" ".backup '$target'"
  ok "wrote $target"
}

cmd_sql() {
  exec sqlite3 "$DB_FILE"
}

cmd_restart() {
  require_macos
  launchctl kickstart -k "$DOMAIN/$LABEL"
  ok "restarted"
}

cmd_update() {
  require_macos
  info "Pulling latest"
  ( cd "$REPO" && git pull --ff-only )
  build
  cmd_restart
}

cmd_status() {
  require_macos
  if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
    launchctl print "$DOMAIN/$LABEL" | grep -E "^\s+(state|pid|last exit)" || true
  else
    echo "not installed"
    return 1
  fi
  if curl -sf "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
    ok "responding on http://127.0.0.1:$PORT"
  else
    echo "  not responding on port $PORT"
  fi
}

cmd_logs() {
  tail -f "$LOG_DIR/server.log"
}

case "${1:-}" in
  install)   cmd_install ;;
  uninstall) cmd_uninstall ;;
  restart)   cmd_restart ;;
  update)    cmd_update ;;
  status)    cmd_status ;;
  logs)      cmd_logs ;;
  backup)    cmd_backup "$@" ;;
  sql)       cmd_sql ;;
  *)
    sed -n '3,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
