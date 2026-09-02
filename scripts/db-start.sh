#!/usr/bin/env bash
# 启动项目本地 MySQL 实例（端口 3307，独立数据目录，不影响系统 MySQL）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MYSQL_DIR="$ROOT/.mysql"

if [ -f "$MYSQL_DIR/mysql.pid" ] && kill -0 "$(cat "$MYSQL_DIR/mysql.pid")" 2>/dev/null; then
  echo "MySQL 已在运行 (pid $(cat "$MYSQL_DIR/mysql.pid"))"
  exit 0
fi

if [ ! -d "$MYSQL_DIR/data" ]; then
  echo "首次初始化数据目录..."
  mysqld --initialize-insecure --datadir="$MYSQL_DIR/data"
fi

mysqld \
  --datadir="$MYSQL_DIR/data" \
  --port=3307 \
  --socket="$MYSQL_DIR/mysql.sock" \
  --pid-file="$MYSQL_DIR/mysql.pid" \
  --log-error="$MYSQL_DIR/error.log" \
  --bind-address=127.0.0.1 \
  --mysqlx=OFF \
  --daemonize

echo "MySQL 已启动 (端口 3307)"
