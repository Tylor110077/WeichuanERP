import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Content-Security-Policy",
    value:
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'",
  },
];

const nextConfig: NextConfig = {
  // Docker 部署使用 standalone 输出（文档 8.4）
  output: "standalone",
  // Next 16 dev 默认拦截非 localhost 源的 dev 资源（含 127.0.0.1 访问），
  // 拦截会导致客户端 chunk 拿不到、页面 hydration 静默失败；按提示放行。
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          ...securityHeaders,
          // 生产环境强制 HTTPS（文档 8.1 传输安全）；本地明文开发不加 HSTS
          ...(process.env.NODE_ENV === "production"
            ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
