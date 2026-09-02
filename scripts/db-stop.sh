#!/usr/bin/env bash
# 停止项目本地 MySQL 实例
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MYSQL_DIR="$ROOT/.mysql"

if [ ! -f "$MYSQL_DIR/mysql.pid" ]; then
  echo "MySQL 未在运行"
  exit 0
fi

PID="$(cat "$MYSQL_DIR/mysql.pid")"
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  echo "已停止 MySQL (pid $PID)"
else
  rm -f "$MYSQL_DIR/mysql.pid"
  echo "MySQL 未在运行"
fi
