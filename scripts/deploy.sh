#!/usr/bin/env bash
# 玮川进销存 一键部署（服务器侧执行）
#
# 用法：
#   deploy.sh [镜像标签] [选项]
# 示例：
#   sudo bash scripts/deploy.sh                      # 部署 latest（CI 最新构建）
#   sudo bash scripts/deploy.sh sha-671642c9e5fe     # 部署指定提交对应的镜像（推荐：可精确回滚）
#   sudo bash scripts/deploy.sh --rollback           # 回滚到上一次部署成功的镜像
#   sudo bash scripts/deploy.sh --no-backup sha-xxx  # 跳过部署前自动备份（赶时间时用）
#   sudo bash scripts/deploy.sh --list               # 看历史部署记录
#
# 为什么服务器不编译：
#   生产机内存小，Next.js 构建会打满内存把线上拖垮。镜像由 GitHub Actions
#   （.github/workflows/build-image.yml）在云端构建后推到 ghcr.io（公开包，无需登录）。
#
# 脚本做的事：
#   1 环境检查 → 2 记录回滚点 → 3 部署前备份 → 4 拉取镜像
#   → 5 用新镜像跑迁移（此步不重启服务）→ 6 切换应用容器 → 7 健康检查 → 8 记录
#   任一步失败，或健康检查不过：自动切回上一个镜像并重新验证。
#   数据库迁移只增不改，回滚不回退表结构（见 docs/部署指南.md §6）。
set -Eeuo pipefail

IMAGE_REPO="${IMAGE_REPO:-ghcr.io/tylor110077/weichuanerp}"
PROJECT_DIR="${WC_PROJECT_DIR:-/opt/weichuan}"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.yml"
ENV_FILE="$PROJECT_DIR/.env"
STATE_DIR="$PROJECT_DIR/.deploy"
HISTORY_FILE="$STATE_DIR/history"
SERVICE="app"
HEALTH_URL="${WC_HEALTH_URL:-http://127.0.0.1:3000/api/health}"
HEALTH_TIMEOUT="${WC_HEALTH_TIMEOUT:-90}" # 秒；首次启动要等 Prisma/Next 起来
HISTORY_KEEP=10

TAG=""
DO_BACKUP=1
MODE="deploy" # deploy | rollback | list

usage() {
  sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --no-backup) DO_BACKUP=0 ;;
    --rollback) MODE="rollback" ;;
    --list) MODE="list" ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "未知参数：$1" >&2; usage >&2; exit 1 ;;
    *)
      if [ -n "$TAG" ]; then echo "只接受一个镜像标签（收到了 $TAG 和 $1）" >&2; exit 1; fi
      TAG="$1"
      ;;
  esac
  shift
done

# docker 权限：拿不到就 sudo 重进（生产机运维账号 wcadmin 免密 sudo）
if [ "${WC_DEPLOY_ELEVATED:-0}" != "1" ] && ! docker info >/dev/null 2>&1; then
  SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  if command -v sudo >/dev/null 2>&1; then
    echo "== docker 权限不足，用 sudo 重新执行 =="
    exec sudo WC_DEPLOY_ELEVATED=1 bash "$SELF" "$@"
  fi
  echo "没有 docker 权限也没有 sudo。请用 root 或 docker 组成员身份执行。" >&2
  exit 1
fi

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

load_history() {
  HISTORY=()
  if [ -f "$HISTORY_FILE" ]; then
    # 不用 mapfile：macOS 自带 bash 3.2 没有它，脚本要能在两种机器上跑
    local line
    while IFS= read -r line; do
      [ -n "$line" ] && HISTORY+=("$line")
    done < "$HISTORY_FILE"
  fi
}

save_history() {
  mkdir -p "$STATE_DIR"
  if [ "${#HISTORY[@]}" -gt 0 ]; then
    printf '%s\n' "${HISTORY[@]}" > "$HISTORY_FILE"
  else
    : > "$HISTORY_FILE"
  fi
}

# 便携写法：GNU date 与 BSD date 都支持 +%Y-%m-%dT%H:%M:%S%z（-I 只有 GNU 有）
now_iso() { date +%Y-%m-%dT%H:%M:%S%z; }

# 历史行格式：<ISO 时间>|<镜像引用>
record_deploy() {
  load_history
  local line="${1}|${2}"
  HISTORY+=("$line")
  # 只留最近 N 条（不用 ${arr[@]: -N} 负偏移切片：bash 3.2 不支持）
  if [ "${#HISTORY[@]}" -gt "$HISTORY_KEEP" ]; then
    local skip=$(( ${#HISTORY[@]} - HISTORY_KEEP ))
    local kept=() i=0 h
    for h in "${HISTORY[@]}"; do
      i=$((i + 1))
      [ "$i" -gt "$skip" ] && kept+=("$h")
    done
    HISTORY=("${kept[@]}")
  fi
  save_history
}

# 取历史里的「当前」与「上一个」：$1 = current | previous
history_pick() {
  local want="$1" cur="" prev="" h
  for h in "${HISTORY[@]}"; do
    prev="$cur"
    cur="$h"
  done
  if [ "$want" = "current" ]; then
    printf '%s' "$cur"
  else
    printf '%s' "$prev"
  fi
}

current_running_image() {
  local cid
  cid="$(compose ps -q "$SERVICE" 2>/dev/null | head -1 || true)"
  [ -n "$cid" ] || return 0
  docker inspect --format '{{.Config.Image}}' "$cid" 2>/dev/null || true
}

health_body() { curl -fsS --max-time 10 "$HEALTH_URL" 2>/dev/null || true; }

health_ok() {
  case "$(health_body)" in *'"ok":true'*) return 0 ;; *) return 1 ;; esac
}

wait_healthy() {
  local waited=0
  while [ "$waited" -lt "$HEALTH_TIMEOUT" ]; do
    if health_ok; then return 0; fi
    sleep 3
    waited=$((waited + 3))
    printf '.'
  done
  echo
  return 1
}

# 用指定镜像启动应用容器（切换与回滚都走这里：只改 APP_IMAGE，不动 YAML）
switch_to() {
  export APP_IMAGE="$1"
  compose up -d "$SERVICE" >/dev/null
}

# ---------- 0. 前置检查 ----------
if [ ! -f "$COMPOSE_FILE" ]; then
  echo "找不到编排文件：$COMPOSE_FILE" >&2
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "找不到环境文件：$ENV_FILE（MYSQL_PASSWORD 等密钥在里面）" >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "缺少 curl，无法做健康检查" >&2
  exit 1
fi
cd "$PROJECT_DIR"

if [ "$MODE" = "list" ]; then
  load_history
  if [ "${#HISTORY[@]}" -eq 0 ]; then
    echo "还没有部署记录（$HISTORY_FILE 为空）。"
  else
    echo "历史部署（旧 → 新，最后一条为当前）："
    i=0
    for line in "${HISTORY[@]}"; do
      i=$((i + 1))
      printf '  %2d. %s  %s\n' "$i" "${line%%|*}" "${line#*|}"
    done
  fi
  RUNNING="$(current_running_image)"
  [ -n "$RUNNING" ] && echo "实际运行中的镜像：$RUNNING"
  exit 0
fi

echo "== 1/8 环境检查 =="
echo "编排文件：$COMPOSE_FILE"
MYSQL_STATE="$(compose ps --format '{{.Service}}={{.State}}' 2>/dev/null | grep '^mysql=' || true)"
echo "数据库：${MYSQL_STATE:-（未运行）}"
RUNNING_IMAGE="$(current_running_image)"
echo "当前应用镜像：${RUNNING_IMAGE:-（未运行）}"
if grep -qE '^[[:space:]]*APP_IMAGE=' "$ENV_FILE" 2>/dev/null; then
  echo "注意：$ENV_FILE 里也写了 APP_IMAGE；本次以命令行传入的镜像为准（环境变量优先于 .env）。"
fi

echo "== 2/8 确定目标镜像 =="
load_history
if [ "${#HISTORY[@]}" -eq 0 ] && [ -n "$RUNNING_IMAGE" ]; then
  # 第一次用本脚本：把"正在跑的镜像"补成历史起点，这样以后能回滚到它
  record_deploy "$(now_iso)" "$RUNNING_IMAGE"
  echo "已把当前运行镜像登记为历史起点：$RUNNING_IMAGE"
fi

if [ "$MODE" = "rollback" ]; then
  if [ "${#HISTORY[@]}" -lt 2 ]; then
    echo "历史里只有一个镜像，没有可回滚的目标。" >&2
    echo "（可用 $0 --list 查看；或直接指定标签：$0 <标签>）" >&2
    exit 1
  fi
  PREV_LINE="$(history_pick previous)"
  TARGET_IMAGE="${PREV_LINE#*|}"
  echo "回滚目标：$TARGET_IMAGE"
elif [ -z "$TAG" ]; then
  TARGET_IMAGE="${IMAGE_REPO}:latest" # 不带参数 = CI 最新的 latest
elif [[ "$TAG" == */* ]]; then
  TARGET_IMAGE="$TAG" # 允许直接给完整镜像引用（如 ghcr.io/other/repo:tag）
else
  TARGET_IMAGE="${IMAGE_REPO}:${TAG}"
fi
echo "本次部署镜像：$TARGET_IMAGE"

echo "== 3/8 部署前备份 =="
if [ "$DO_BACKUP" = "0" ]; then
  echo "已按 --no-backup 跳过。"
elif [ -z "$(compose ps -q "$SERVICE" 2>/dev/null || true)" ]; then
  echo "应用容器未在运行（首次部署？），跳过。"
else
  compose exec -T "$SERVICE" npx tsx scripts/backup.ts
  echo "备份完成（见 $PROJECT_DIR/backups）。"
fi

echo "== 4/8 拉取镜像 =="
if ! docker pull "$TARGET_IMAGE"; then
  echo "拉取失败。若是网络问题可重试；确认标签拼写：$TARGET_IMAGE" >&2
  exit 1
fi
DIGEST="$(docker image inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}' "$TARGET_IMAGE" 2>/dev/null || true)"

echo "== 5/8 数据库迁移（用新镜像跑，不影响正在服务的旧容器）=="
export APP_IMAGE="$TARGET_IMAGE"
if ! compose run -T --rm --no-deps "$SERVICE" npx prisma migrate deploy; then
  echo "迁移失败：应用容器未切换，线上仍是旧版本，无需回滚。" >&2
  exit 1
fi

echo "== 6/8 切换应用容器 =="
switch_to "$TARGET_IMAGE"
ACTUAL="$(current_running_image)"
echo "容器已启动，镜像：${ACTUAL:-（未知）}"

echo "== 7/8 健康检查（最多 ${HEALTH_TIMEOUT}s）=="
if wait_healthy; then
  echo
  echo "健康检查通过：$(health_body)"
else
  echo "健康检查未通过！"
  echo "--- 最近 50 行容器日志 ---"
  compose logs --tail=50 "$SERVICE" || true
  echo "--- 日志结束 ---"
  if [ -n "$RUNNING_IMAGE" ] && [ "$RUNNING_IMAGE" != "$TARGET_IMAGE" ]; then
    echo "== 自动回滚到 $RUNNING_IMAGE =="
    switch_to "$RUNNING_IMAGE"
    if wait_healthy; then
      echo
      echo "已回滚，服务恢复正常。请排查新镜像问题后重试。"
    else
      echo
      echo "回滚后仍不健康，需要人工介入："
      echo "  查看日志：docker compose -f $COMPOSE_FILE logs --tail=200 $SERVICE"
      echo "  查数据库：docker compose -f $COMPOSE_FILE ps"
    fi
  else
    echo "没有可回滚的旧镜像（本次是首次部署或本来就未运行）。"
  fi
  exit 1
fi

echo "== 8/8 记录本次部署 =="
record_deploy "$(now_iso)" "$TARGET_IMAGE"
cat <<EOF

部署完成
  镜像：$TARGET_IMAGE
  摘要：${DIGEST:-（无 RepoDigest，可能未推送）}
  健康：$(health_body)
  回滚：sudo bash $0 --rollback
  记录：$HISTORY_FILE
EOF
