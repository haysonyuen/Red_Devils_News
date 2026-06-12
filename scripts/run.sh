#!/usr/bin/env bash
set -euo pipefail

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
unset npm_config_prefix
unset NPM_CONFIG_PREFIX
if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
  echo "nvm is required. Install Node $(cat .nvmrc) or load nvm before running this project." >&2
  exit 1
fi

# shellcheck source=/dev/null
source "$NVM_DIR/nvm.sh"
nvm use --silent

case "${1:-}" in
  start)
    exec env TZ=Europe/London node dist/bootstrap.js
    ;;
  dev)
    node node_modules/typescript/bin/tsc
    exec env TZ=Europe/London node dist/bootstrap.js
    ;;
  dev-now)
    node node_modules/typescript/bin/tsc
    exec env TZ=Europe/London node dist/bootstrap.js --run-now
    ;;
  test)
    node node_modules/typescript/bin/tsc
    node dist/ingestion/bbcRss.test.js
    node dist/mcp/server.test.js
    node dist/graph/agents.test.js
    node dist/graph/editorial-contracts.test.js
    node dist/graph/visual-contracts.test.js
    node dist/references/coordinator.test.js
    node dist/webhooks/slack.test.js
    node dist/evals/persona.test.js
    ;;
  *)
    echo "Usage: scripts/run.sh {start|dev|dev-now|test}" >&2
    exit 1
    ;;
esac
