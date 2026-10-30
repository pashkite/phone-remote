#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"
mkdir -p .sites-runtime/ci
node --input-type=module <<'JS'
import { writeFileSync } from 'node:fs';
writeFileSync('.sites-runtime/ci/wrangler.json', JSON.stringify({
  name: 'galaxy-remote-types-only', compatibility_date: '2026-10-30',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: [{binding: 'DB', database_name: 'local-types-only', database_id: '00000000-0000-4000-8000-000000000000'}]
}));
JS
bash scripts/sites-env.sh -- node_modules/.bin/wrangler types worker-configuration.d.ts --config .sites-runtime/ci/wrangler.json
bash scripts/sites-env.sh -- node_modules/.bin/tsc --noEmit
bash scripts/sites-env.sh -- node_modules/.bin/vinext build
bash scripts/sites-env.sh -- bash scripts/validate-artifact.sh
node --test tests/*.test.mjs
python3 -B -m unittest discover -s scripts/tests -v
