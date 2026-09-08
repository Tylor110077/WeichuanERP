import "server-only";
import { headers } from "next/headers";

/** 取客户端 IP（生产经 Nginx 反代传入 X-Forwarded-For / X-Real-IP）。 */
export async function getClientIp(): Promise<string | null> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    null
  );
}
