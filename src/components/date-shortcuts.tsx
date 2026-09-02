import { presetRanges } from "@/lib/date-presets";

/**
 * 日期快捷筛选条：今日/昨日/本周/本月/今年。
 * 纯链接（服务端渲染，无 JS），点击即带上 from/to 查询参数跳到目标页。
 */
export function DateShortcuts({
  basePath,
  extraQuery,
}: {
  basePath: string;
  extraQuery?: Record<string, string>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-gray-400">快捷：</span>
      {presetRanges().map((p) => {
        const sp = new URLSearchParams({ from: p.from, to: p.to });
        for (const [k, v] of Object.entries(extraQuery ?? {})) {
          if (v) sp.set(k, v);
        }
        return (
          <a
            key={p.key}
            href={`${basePath}?${sp.toString()}`}
            className="rounded-md border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:border-blue-300 hover:text-blue-600"
          >
            {p.label}
          </a>
        );
      })}
    </div>
  );
}
