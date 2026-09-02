import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 16 dev 默认拦截非 localhost 源的 dev 资源（含 127.0.0.1 访问），
  // 拦截会导致客户端 chunk 拿不到、页面 hydration 静默失败；按提示放行。
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
