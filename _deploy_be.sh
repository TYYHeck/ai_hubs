#!/usr/bin/env bash
set -e
cd /root/ai_hubs
git pull --ff-only origin main
systemctl restart ai_hubs
sleep 2
systemctl is-active ai_hubs && echo "BACKEND_ACTIVE"
