#!/usr/bin/env bash
# 玮川进销存 一键启用 HTTPS（域名备案 + DNS 解析到位后执行）
#
# 用法：
#   enable-https.sh <域名> <证书通知邮箱> [--staging]
# 示例：
#   ./enable-https.sh weichuanerp.com admin@example.com             # 正式签发
#   ./enable-https.sh weichuanerp.com admin@example.com --staging   # 用测试 CA 演练（不消耗正式额度）
#
# 前置条件（缺一不可，否则脚本会给出提示并中止）：
#   1. 域名已完成 ICP 备案（阿里云国内服务器访问 80/443 的前提）
#   2. 域名 DNS A 记录已解析到本服务器公网 IP，且解析已生效
#   3. 服务器安全组/防火墙已放行 80、443
#
# 脚本做的事：安装 certbot → 预置 HTTP 校验配置 → 申请证书 → 写入完整 HTTPS 配置
#（80 强制跳 443、TLS1.2+、OCSP stapling、反代与限流）→ 校验并热加载 → 检查自动续签
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
STAGING="${3:-}"

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
  echo "用法：$0 <域名> <证书通知邮箱> [--staging]"
  exit 1
fi
if ! [[ "$DOMAIN" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$ ]]; then
  echo "域名格式不正确：$DOMAIN"
  exit 1
fi
if [ "$(id -u)" != "0" ]; then
  echo "请用 root 执行（sudo $0 ...）"
  exit 1
fi

cd /opt/weichuan
CERT_BASE="/etc/letsencrypt/live/${DOMAIN}"
CERTBOT_ARGS="--nginx -d ${DOMAIN} --non-interactive --agree-tos -m ${EMAIL} --keep-until-expiring"
if [ "$STAGING" = "--staging" ]; then
  CERTBOT_ARGS="$CERTBOT_ARGS --staging"
  echo "== 使用 Let's Encrypt 测试环境（证书不被浏览器信任，仅用于演练）=="
fi

echo "== 1/6 检查 DNS 解析 =="
SERVER_IP="$(curl -s --max-time 8 https://api.ipify.org || curl -s --max-time 8 ifconfig.me || true)"
DNS_IP="$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1}' | head -1 || true)"
echo "   服务器公网 IP：${SERVER_IP:-未知}"
echo "   域名解析到：  ${DNS_IP:-未解析}"
if [ -z "$DNS_IP" ]; then
  echo "   警告：域名尚未解析。请先在阿里云 DNS 添加 A 记录指向 ${SERVER_IP}"
  echo "   继续执行将因 HTTP 校验失败而中止。5 秒后继续（Ctrl+C 退出）…"
  sleep 5
elif [ -n "$SERVER_IP" ] && [ "$DNS_IP" != "$SERVER_IP" ]; then
  echo "   警告：解析地址与服务器公网 IP 不一致（若用了 CDN/代理可忽略）"
fi

echo "== 2/6 安装 certbot =="
export DEBIAN_FRONTEND=noninteractive
if ! command -v certbot >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq certbot python3-certbot-nginx
fi
certbot --version

echo "== 3/6 写入 HTTP 预置配置（供证书校验）=="
cat > /etc/nginx/sites-available/weichuan <<NGINX
# 玮川进销存 反代（HTTP；证书申请期间的校验入口，签发后自动改为 301 跳转）
server {
    listen 80 default_server;
    server_name ${DOMAIN} _;
    server_tokens off;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX
mkdir -p /var/www/certbot
nginx -t && systemctl reload nginx

echo "== 4/6 申请证书 =="
# shellcheck disable=SC2086
if ! certbot certonly ${CERTBOT_ARGS}; then
  echo "证书申请失败。常见原因：域名未备案 / 解析未生效 / 80 端口未放行。"
  echo "排查后可重新执行本脚本（幂等，不会破坏现有配置）。"
  exit 1
fi
ls -la "$CERT_BASE" 2>/dev/null | tail -3

echo "== 5/6 写入 HTTPS 配置 =="
# 限流 zone（http 上下文，登录等写操作防滥用）
cat > /etc/nginx/conf.d/weichuan-limits.conf <<'LIMITS'
# 玮川进销存 限流（Nginx 层兜底，应用层另有 IP 级登录限流）
limit_req_zone $binary_remote_addr zone=weichuan_all:10m rate=30r/s;
limit_req_zone $binary_remote_addr zone=weichuan_login:10m rate=2r/s;
limit_conn_zone $binary_remote_addr zone=weichuan_conn:10m;
LIMITS

cat > /etc/nginx/sites-available/weichuan <<NGINX
# 玮川进销存 反代（HTTPS 正式配置；HTTP 全量 301 跳转）
server {
    listen 80 default_server;
    server_name ${DOMAIN} _;
    server_tokens off;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl default_server;
    http2 on;
    server_name ${DOMAIN};
    server_tokens off;

    ssl_certificate     ${CERT_BASE}/fullchain.pem;
    ssl_certificate_key ${CERT_BASE}/privkey.pem;

    # 传输加固（文档 8.1）：仅 TLS1.2+，启用会话缓存与 OCSP stapling
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;
    ssl_stapling on;
    ssl_stapling_verify on;
    resolver 223.5.5.5 119.29.29.29 valid=300s;
    resolver_timeout 5s;

    # 请求体限制与超时（防慢速与大包滥用）
    client_max_body_size 5m;
    client_body_timeout 30s;
    client_header_timeout 20s;
    send_timeout 60s;

    # 全局限流 + 连接数限制
    limit_req zone=weichuan_all burst=60 nodelay;
    limit_conn weichuan_conn 30;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 120s;
    }

    # 登录接口单独更严的限流（应用层已有 IP 级限流，此处为边界兜底）
    location /login {
        limit_req zone=weichuan_login burst=10 nodelay;
        limit_conn weichuan_conn 10;
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX

nginx -t && systemctl reload nginx && echo "   nginx 已热加载"

echo "== 6/6 验证 =="
echo -n "   HTTP 跳转："; curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" --max-time 10 "http://${DOMAIN}/login" || true
echo -n "   HTTPS 访问："; curl -s -o /dev/null -w "%{http_code}\n" --max-time 15 "https://${DOMAIN}/login" || true
echo -n "   证书有效期："; echo | openssl s_client -servername "$DOMAIN" -connect "${DOMAIN}:443" 2>/dev/null | openssl x509 -noout -dates 2>/dev/null | tr '\n' ' ' || echo "读取失败"
echo "   自动续签定时器：$(systemctl list-timers certbot.timer --no-pager 2>/dev/null | sed -n 2p | awk '{print $1" "$2" "$3}')"
echo
echo "完成。后续建议："
echo "  1) 将访问地址正式切为 https://${DOMAIN}，并通知用户更新书签"
echo "  2) 如需禁止 IP 直连访问，在云防火墙关闭 80（保留 443）"
echo "  3) 证书 90 天自动续签；可在 https://www.ssllabs.com/ssltest/ 复核评级"
