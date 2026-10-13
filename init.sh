#!/bin/sh
set -eu
cd "$(dirname "$0")"
node -e 'if (+process.versions.node.split(".")[0] < 24) process.exit(1)'
test -d node_modules || npm ci
npm test
npm run build
