#!/bin/bash
set -e

cd /root/ai_hubs

echo "=== git pull ==="
git stash
git pull origin main
git stash pop || true

echo "=== restart service ==="
systemctl restart ai_hubs

echo "=== reload nginx ==="
systemctl reload nginx

echo "=== done ==="
systemctl status ai_hubs --no-pager
