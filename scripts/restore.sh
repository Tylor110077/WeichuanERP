#!/usr/bin/env bash
# 玮川进销存 恢复脚本：解密备份并导入 MySQL
# 用法：
#   恢复演练（推荐）：restore.sh <备份文件.gpg> --db weichuan_erp_drill
#   生产恢复（危险）：restore.sh <备份文件.gpg> --db weichuan_erp --force
set -euo pipefail

FILE="${1:-}"
shift || true
DB=""
FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --db) DB="${2:-}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    *) echo "未知参数：$1"; exit 1 ;;
  esac
done

if [ -z "$FILE" ] || [ ! -f "$FILE" ] || [ -z "$DB" ]; then
  echo "用法：restore.sh <备份文件.gpg> --db <目标库名> [--force]"
  exit 1
fi
KEY_FILE="/root/.weichuan/backup.key"
cd /opt/weichuan

if [ "$FORCE" = "1" ] && [ "$DB" = "weichuan_erp" ]; then
  echo "警告：即将向生产库 weichuan_erp 导入数据（10 秒后开始，Ctrl+C 取消）"
  sleep 10
fi

# 建目标库（演练库）
docker compose exec -T mysql sh -c \
  "mysql -u root -p\"\$MYSQL_ROOT_PASSWORD\" -e \"CREATE DATABASE IF NOT EXISTS \\\`${DB}\\\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci\""

# 解密 → 解压 → 导入
gpg --batch --yes --quiet --passphrase-file "$KEY_FILE" -d "$FILE" \
  | gunzip \
  | docker compose exec -T mysql sh -c "mysql -u root -p\"\$MYSQL_ROOT_PASSWORD\" '${DB}'"

echo "恢复完成 → 库：${DB}"
echo "演练核对建议：SELECT COUNT(*) FROM ${DB}.sale_orders; SELECT COUNT(*) FROM ${DB}.products; SELECT COUNT(*) FROM ${DB}.audit_logs;"
