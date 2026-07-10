-- AI Hubs MySQL 初始化脚本
-- Docker Compose 首次启动时自动执行

-- 设置字符集
ALTER DATABASE ai_hubs CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 确保表已创建 (由应用迁移负责，这里作为备用)
FLUSH PRIVILEGES;
