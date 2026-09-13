import { presetRanges } from "@/lib/date-presets";

/**
 * 日期快捷筛选条：全部时间 / 今日 / 昨日 / 本周 / 本月 / 今年。
 * 纯链接（服务端渲染，无 JS），点击即带上 from/to 查询参数跳到目标页；
 * 「全部时间」不带 from/to，等于把时段清空。
 *
 * current 传当前生效的时段（页面把自己的 from/to 传进来），用来高亮正在看的那一档；
 * 不传也能用，只是没有高亮。
 */
export function DateShortcuts({
  basePath,
  extraQuery,
  current,
}: {
  basePath: string;
  extraQuery?: Record<string, string>;
  /** 当前生效的时段：与某一档完全一致时该档高亮；两者皆空则「全部时间」高亮 */
  current?: { from?: string; to?: string };
}) {
  const hrefFor = (preset?: { from: string; to: string }) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(extraQuery ?? {})) {
      if (v) sp.set(k, v);
    }
    if (preset) {
      sp.set("from", preset.from);
      sp.set("to", preset.to);
    }
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const chip = (on: boolean) =>
    `rounded-md border px-2.5 py-1 text-xs transition ${
      on
        ? "border-blue-300 bg-blue-50 font-medium text-blue-700"
        : "border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600"
    }`;

  const noRange = !current?.from && !current?.to;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-gray-400">快捷：</span>
      <a href={hrefFor()} className={chip(noRange)} title="不限时间，看全部记录">
        全部时间
      </a>
      {presetRanges().map((p) => {
        const on = current?.from === p.from && current?.to === p.to;
        return (
          <a key={p.key} href={hrefFor(p)} className={chip(on)}>
            {p.label}
          </a>
        );
      })}
    </div>
  );
}
