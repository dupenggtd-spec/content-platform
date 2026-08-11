#!/bin/bash
# 火花台启动脚本 - 双击运行
cd ~/Desktop/projects/content-platform

# 杀掉旧进程（端口8000）
lsof -ti:8000 | xargs kill -9 2>/dev/null

# 启动服务
node server.js &
SERVER_PID=$!

# 等待启动
sleep 2

if lsof -i:8000 >/dev/null 2>&1; then
  echo "✅ 火花台已启动 → http://localhost:8000"
  open http://localhost:8000
else
  echo "❌ 启动失败，请检查终端报错"
fi
