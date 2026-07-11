#!/bin/bash
set -e
cd /root/ai_hubs
git stash
git pull
git stash pop || true
systemctl restart ai_hubs
echo "backend deployed"
