#!/bin/bash
set -e

cd /root/ai_hubs

echo "=== 1. 拉取最新代码 ==="
git stash
git pull origin main
git stash pop || true

echo "=== 2. 安装后端依赖 ==="
source venv/bin/activate
pip install -r requirements.txt

echo "=== 3. 构建前端 ==="
cd frontend
npm install
npm run build
cd ..

echo "=== 4. 复制前端静态文件 ==="
mkdir -p /var/www/ai_hubs
rm -rf /var/www/ai_hubs/dist
cp -r dist /var/www/ai_hubs/ || cp -r frontend/dist /var/www/ai_hubs/ || true

echo "=== 5. 更新 Nginx 配置 ==="
cp deploy/nginx.conf /etc/nginx/sites-available/ai_hubs
ln -sf /etc/nginx/sites-available/ai_hubs /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t

echo "=== 6. 更新 systemd 服务 ==="
cp deploy/ai_hubs.service /etc/systemd/system/
systemctl daemon-reload

echo "=== 7. 停止旧项目 (8080端口) ==="
# 检查并停止占用 8080 端口的旧进程
if lsof -ti:8080 > /dev/null 2>&1; then
    echo "发现 8080 端口有进程，正在停止..."
    kill -9 $(lsof -ti:8080) 2>/dev/null || true
    sleep 1
fi

# 停止旧的 systemd 服务（如果存在）
systemctl stop ai_hubs_old 2>/dev/null || true
systemctl disable ai_hubs_old 2>/dev/null || true

echo "=== 8. 启动/重启后端服务 ==="
systemctl restart ai_hubs
systemctl enable ai_hubs

echo "=== 9. 重载 Nginx ==="
systemctl reload nginx

echo "=== 10. 清理旧项目文件 ==="
# 删除常见的旧项目目录（如果存在且不是新项目）
for dir in /root/agent_old /root/old_agent /root/agent_v1 /root/ai_hubs_old; do
    if [ -d "$dir" ]; then
        echo "删除旧项目目录: $dir"
        rm -rf "$dir"
    fi
done

echo "=== 完成 ==="
echo "服务状态:"
systemctl status ai_hubs --no-pager | head -10
echo ""
echo "Nginx 状态:"
systemctl status nginx --no-pager | head -5
echo ""
echo "端口监听:"
ss -tlnp | grep -E ':(80|8080|8082)\s' || true
echo ""
echo "访问地址:"
echo "  http://<服务器IP> (80端口)"
echo "  http://<服务器IP>:8080 (8080端口)"
echo "  两个端口指向同一个项目"
