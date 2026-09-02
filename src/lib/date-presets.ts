/**
 * 日期快捷筛选（今日/昨日/本周/本月/今年）。
 * 一键预设 = 计算起止日期字符串，页面按既有 from/to 参数解析，无需新增查询逻辑。
 */

export interface DatePreset {
  key: string;
  label: string;
  from: string;
  to: string;
}

export function fmtDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function presetRanges(): DatePreset[] {
  const now = new Date();
  const today = fmtDate(now);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() || 7) - 1)); // 周一起
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);
  return [
    { key: "today", label: "今日", from: today, to: today },
    { key: "yesterday", label: "昨日", from: fmtDate(yesterday), to: fmtDate(yesterday) },
    { key: "week", label: "本周", from: fmtDate(weekStart), to: today },
    { key: "month", label: "本月", from: fmtDate(monthStart), to: today },
    { key: "year", label: "今年", from: fmtDate(yearStart), to: today },
  ];
}
