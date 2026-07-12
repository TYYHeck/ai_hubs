#!/usr/bin/env bash
set +e
cd /root/ai_hubs 2>/dev/null || { echo "NO_REPO"; exit 1; }
echo "===== git status (untracked-all) ====="
git status --porcelain --untracked-files=all | head -80
echo "===== 关键运行时文件需保留 ====="
for f in config.yaml data venv .env backend/app/core/config.yaml; do
  if [ -e "$f" ]; then echo "KEEP: $f (exists)"; else echo "absent: $f"; fi
done
echo "===== 已知陈旧实验文件是否存在 ====="
for f in backend/app/models/knowledge.py backend/app/schemas/knowledge.py backend/app/api/v1/knowledge.py.bak models/knowledge.py; do
  if [ -f "$f" ]; then echo "STALE: $f"; fi
done
echo "===== 冲突标记文件扫描 backend/app ====="
grep -rl '^<<<<<<< \|^======= \|^>>>>>>> ' backend/app 2>/dev/null | head -20 || echo "none"
echo "===== 备份/冲突副件 (.orig/.bak/.*.swp) ====="
find . -path ./venv -prune -o \( -name '*.orig' -o -name '*.bak' -o -name '*.BACKUP.*' -o -name '*.BASE.*' -o -name '*.LOCAL.*' -o -name '*.REMOTE.*' \) -print 2>/dev/null | grep -v '/venv/' | head -40
echo "===== __pycache__ 目录数 ====="
find . -path ./venv -prune -o -type d -name __pycache__ -print 2>/dev/null | grep -v '/venv/' | wc -l
echo "===== .pyc 文件数(venv外) ====="
find . -path ./venv -prune -o -name '*.pyc' -print 2>/dev/null | grep -v '/venv/' | wc -l
echo "===== /tmp 部署脚本残留 ====="
ls -la /tmp/deploy_backend.sh /tmp/verify.sh 2>/dev/null || echo "no tmp scripts"
echo "DONE"
