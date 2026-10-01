#!/usr/bin/env bash
set -Eeuo pipefail

deploy_remote() {
  local archive=$1 expected_sha=$2
  local app=/www/wwwroot/duo_chess service=duo-chess.service
  local auth=/var/lib/duo-chess/auth.json
  local stage backup failed old_moved=0 installed=0 complete=0 auth_before

  [[ $EUID -eq 0 ]] || { echo 'Remote deployment requires root.' >&2; exit 1; }
  exec 9>/run/duo-chess-deploy.lock
  flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }
  [[ -d $app && ! -L $app ]] || { echo "Expected existing application: $app" >&2; exit 1; }
  systemctl cat "$service" >/dev/null
  local environment
  environment=$(systemctl show "$service" --property=Environment --value)
  for required in 'PORT=8900' 'AUTH_FILE=/var/lib/duo-chess/auth.json' 'STOCKFISH_PATH=/usr/games/stockfish'; do
    [[ " $environment " == *" $required "* ]] || {
      echo "Service must contain Environment=$required" >&2; exit 1;
    }
  done
  node -e 'if (Number(process.versions.node.split(".")[0]) < 18) process.exit(1)'
  printf '%s  %s\n' "$expected_sha" "$archive" | sha256sum --check --status
  if [[ ! -x /usr/games/stockfish ]]; then
    command -v apt-get >/dev/null
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y stockfish
  fi
  [[ -x /usr/games/stockfish ]]
  auth_before=absent
  if [[ -f $auth ]]; then
    auth_before=$(sha256sum "$auth")
  fi
  stage=$(mktemp -d "${app}.stage-XXXXXXXX")
  backup="${app}.backup-$(date +%Y%m%dT%H%M%S)-$$"
  failed="${app}.failed-$(date +%Y%m%dT%H%M%S)-$$"

  # Keep the old directory until restart and HTTP checks have succeeded.
  finish_remote() {
    local status=$?
    trap - EXIT INT TERM
    set +e
    if [[ $complete -eq 0 && $old_moved -eq 1 ]]; then
      echo 'Deployment failed; restoring the previous version.' >&2
      journalctl -u "$service" -n 25 --no-pager >&2
      if [[ $installed -eq 1 ]]; then
        mv "$app" "$failed"
      fi
      if mv "$backup" "$app"; then
        systemctl restart "$service"
        systemctl is-active "$service" || status=1
      else
        echo "Rollback failed; previous version is at $backup" >&2
        status=1
      fi
    fi
    [[ ! -d $stage ]] || rm -rf -- "$stage"
    rm -f -- "$archive" "$0"
    exit "$status"
  }
  trap finish_remote EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  tar --no-same-owner -xzf "$archive" -C "$stage"
  test -f "$stage/assets/vendor/chess.mjs"
  node --check "$stage/server.js"
  chown -R root:root "$stage"
  find "$stage" -type d -exec chmod 0755 {} +
  find "$stage" -type f -exec chmod 0644 {} +
  mv "$app" "$backup"
  old_moved=1
  mv "$stage" "$app"
  installed=1
  systemctl restart "$service"

  local healthy=0 configured=false status_json
  [[ $auth_before == absent ]] || configured=true
  for attempt in {1..15}; do
    if systemctl is-active --quiet "$service" &&
      status_json=$(curl --fail --silent --show-error --max-time 3 http://127.0.0.1:8900/api/auth/status) &&
      printf '%s' "$status_json" | node -e '
        let data = "";
        process.stdin.on("data", chunk => data += chunk);
        process.stdin.on("end", () => {
          try { if (JSON.parse(data).configured !== (process.argv[1] === "true")) process.exit(1); }
          catch { process.exit(1); }
        });
      ' "$configured"; then
      healthy=1
      break
    fi
    sleep 1
  done
  [[ $healthy -eq 1 ]] || { echo 'Application health check failed.' >&2; exit 1; }
  if [[ $auth_before != absent ]]; then
    [[ $(sha256sum "$auth") == "$auth_before" ]]
  else
    [[ ! -e $auth ]]
  fi
  local login_status
  login_status=$(curl --silent --show-error --max-time 15 --output /dev/null --write-out '%{http_code}' https://chess.pathwit.com/login)
  [[ $login_status == 200 ]] || { echo "HTTPS login check failed: HTTP $login_status" >&2; exit 1; }
  complete=1
  echo "Deployment succeeded: $app (port 8900)"
  echo "Backup: $backup"
  echo 'URL: https://chess.pathwit.com/'
  finish_remote
}

if [[ ${1:-} == --remote ]]; then
  [[ $# -eq 3 ]] || exit 2
  deploy_remote "$2" "$3"
  exit 0
fi

if [[ $# -gt 1 || ${1:-} == -* ]]; then
  echo 'Usage: bash deploy.sh [SSH_HOST]  (default: FS)' >&2
  exit 2
fi
host=${1:-FS}
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd "$root"
for command in ssh scp tar node; do
  command -v "$command" >/dev/null || { echo "Missing command: $command" >&2; exit 1; }
done
node --check server.js
node --test auth.test.js

temporary=$(mktemp -d "${TMPDIR:-/tmp}/duo-chess-deploy.XXXXXXXX")
trap 'rm -rf -- "$temporary"' EXIT
release="duo-chess-$(date +%Y%m%dT%H%M%S)-$$"
archive="$temporary/$release.tar.gz"
remote_archive="/tmp/$release.tar.gz"
remote_script="/tmp/$release.sh"

# An allowlist prevents credentials and local inspection artifacts from shipping.
tar_options=()
if [[ $(uname -s) == Darwin ]]; then
  tar_options=(--disable-copyfile --no-xattrs)
fi
COPYFILE_DISABLE=1 tar "${tar_options[@]}" --exclude='.DS_Store' --exclude='._*' \
  -czf "$archive" \
  server.js app.js index.html login.html styles.css assets README.md auth.test.js deploy.sh
if command -v sha256sum >/dev/null; then
  checksum=$(sha256sum "$archive")
else
  checksum=$(shasum -a 256 "$archive")
fi
checksum=${checksum%% *}
echo "Uploading to $host..."
scp -o ForwardAgent=no "$archive" "$host:$remote_archive"
scp -o ForwardAgent=no "$root/deploy.sh" "$host:$remote_script"
echo 'Starting deployment over interactive SSH...'
ssh -tt -o ForwardAgent=no "$host" "bash '$remote_script' --remote '$remote_archive' '$checksum'"
