#!/usr/bin/env bash
set +e
cd /root/ai_hubs
echo "===== dry-run: git clean -fdx 但排除 data/venv/.env/*.log ====="
git clean -ndx -e data -e venv -e '.env' -e '*.log' | head -60
echo "DRYRUN_DONE"
