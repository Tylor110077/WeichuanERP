#!/usr/bin/env bash
# 玮川进销存 每日备份：mysqldump → gzip → GPG 对称加密（AES256）→ 保留 30 天
# 用法：backup.sh（由 /etc/cron.d/weichuan-backup 每日 02:00 调用）
# 依赖：/root/.weichuan/backup.key（GPG 口令，600，需离线抄录一份）
set -euo pipefail

cd /opt/weichuan
BACKUP_DIR="/opt/weichuan/backups"
KEY_FILE="/root/.weichuan/backup.key"
LOG="/var/log/weichuan-backup.log"
STAMP="$(date +%F)"
OUT="${BACKUP_DIR}/weichuan_erp_${STAMP}.sql.gz.gpg"
TMP="${BACKUP_DIR}/.tmp_${STAMP}.sql"

mkdir -p "$BACKUP_DIR"
log() { echo "$(date '+%F %T') $*" >> "$LOG"; }

if [ ! -f "$KEY_FILE" ]; then
  log "ERROR 密钥文件缺失：$KEY_FILE（备份中止）"
  exit 1
fi

# 1. 导出（--single-transaction 不锁表）
if ! docker compose exec -T mysql sh -c \
  'mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers weichuan_erp' > "$TMP"; then
  log "ERROR mysqldump 失败"
  rm -f "$TMP"
  exit 1
fi

# 2. 压缩 + 加密
if ! gzip -c "$TMP" | gpg --batch --yes --quiet \
  --passphrase-file "$KEY_FILE" --symmetric --cipher-algo AES256 -o "$OUT"; then
  log "ERROR 加密失败"
  rm -f "$TMP" "$OUT"
  exit 1
fi
rm -f "$TMP"
chmod 644 "$OUT"

# 3. 自检：能解密且是合法 gzip（防止产生损坏备份）
if ! gpg --batch --yes --quiet --passphrase-file "$KEY_FILE" -d "$OUT" 2>/dev/null | gzip -t; then
  log "ERROR 备份自检失败（解密/gzip 校验不通过）"
  exit 1
fi

# 4. 轮转：保留 30 天
find "$BACKUP_DIR" -name 'weichuan_erp_*.sql.gz.gpg' -mtime +30 -delete

SIZE="$(du -h "$OUT" | cut -f1)"
log "OK ${OUT##*/} ${SIZE}"
