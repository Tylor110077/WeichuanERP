import { pinyin } from "pinyin-pro";

/**
 * 需要拼音词典的部分（只在服务端用）。
 *
 * 为什么单独一个文件：pinyin-pro 有 300 多 KB，一旦被客户端组件间接引入，
 * 每个带下拉的页面都要为它多下载一份。浏览器里只做「拿服务端算好的 py 做匹配」
 * （见 lib/pinyin.ts 的 matchesSearch），所以这里加了 server-only 兜底：
 * 哪天被客户端组件误引，浏览器里会立刻抛错（不是构建期拦截，但足够醒目）。
 * 不用 server-only 是因为 tsx 跑的测试与回填脚本也要 import 这个模块。
 */

export function initials(text: string): string {
  if (!text) return "";
  const arr = pinyin(text, {
    pattern: "first",
    toneType: "none",
    type: "array",
    nonZh: "consecutive",
  }) as string[];
  return arr.join("").toLowerCase();
}

export function searchPinyin(...parts: (string | null | undefined)[]): string {
  const pieces = parts
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .map((p) => initials(p.trim()))
    .filter((p) => p.length > 0);
  // 库里是 varchar(255)：超长截断，避免写入报错（正常名称远到不了）
  return pieces.join(" ").slice(0, 255);
}

// 兜底：这个模块只能在服务端用。真被客户端组件误引，浏览器里会立刻抛错，
// 而不是悄悄把 300 多 KB 的拼音词典塞进页面。
if (typeof window !== "undefined") {
  throw new Error("lib/pinyin-server 只能在服务端使用（客户端请用服务端下发的 py 做匹配）");
}
