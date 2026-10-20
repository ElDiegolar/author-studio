#!/usr/bin/env bash
# Start the Author Studio web app on a project directory (default ~/novels/the-salt-road).
# Usage: ./start.sh [project-dir]   -> http://127.0.0.1:8790
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
. "$HOME/.nvm/nvm.sh" >/dev/null
export AUTHOR_PROJECT="${1:-$HOME/novels/the-salt-road}"
export PORT="${PORT:-8790}"
[ -d packages/web/dist ] || npm run build
exec node packages/server/dist/main.js
