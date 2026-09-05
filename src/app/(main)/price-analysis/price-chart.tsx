"use client";

import { useState, type MouseEvent } from "react";
import type { DayStats, PricePoint } from "@/lib/price-analysis";

const W = 960;
const H = 300;
const PAD = { l: 64, r: 20, t: 18, b: 30 };
const DOT = "#6b7280"; // 售价点统一灰色（客户一多颜色不够用）
const COST = "#f97316"; // 成本线

/** 售价 × 成本图：灰点为每笔实际售价；橙线为当日成本（数量加权）；
 * 当日成本有高有低时，按最高/最低连线成着色波动区间。 */
export function PriceChart({
  points,
  byDay,
  refSalePrice,
}: {
  points: PricePoint[];
  byDay: DayStats[];
  refSalePrice: number;
}) {
  const [tip, setTip] = useState<{ left: number; top: number; p: PricePoint } | null>(null);

  if (byDay.length === 0) return null;

  const values = [
    ...points.map((p) => p.unitPrice),
    ...byDay.flatMap((d) => [d.minCost, d.maxCost]),
  ].filter((v) => v > 0);
  let min = Math.min(...values);
  let max = Math.max(...values);
  const span = max - min || Math.max(max * 0.1, 1);
  min = Math.max(min - span * 0.08, 0);
  max = max + span * 0.08;

  const plotW = W - PAD.l - PAD.r;
  const n = byDay.length;
  const xOfDay = (i: number) => (n === 1 ? PAD.l + plotW / 2 : PAD.l + (i / (n - 1)) * plotW);
  const dayIndex = new Map(byDay.map((d, i) => [d.dayTs, i]));
  const yOf = (v: number) => H - PAD.b - ((v - min) / (max - min || 1)) * (H - PAD.t - PAD.b);

  const fmtY = (v: number) => (v >= 1000 ? `¥${v.toFixed(0)}` : `¥${v.toFixed(2)}`);
  const showRef = refSalePrice > 0 && refSalePrice >= min && refSalePrice <= max;

  // 波动区间：上边界连每日最高成本，下边界倒序连每日最低成本
  const bandPath =
    n > 1
      ? `M${byDay.map((d, i) => `${xOfDay(i)},${yOf(d.maxCost)}`).join(" L")} L${byDay
          .map((d, i) => `${xOfDay(i)},${yOf(d.minCost)}`)
          .reverse()
          .join(" L")} Z`
      : "";
  const costLine = byDay.map((d, i) => `${xOfDay(i)},${yOf(d.avgCost)}`).join(" ");

  function onDot(e: MouseEvent<SVGCircleElement>, p: PricePoint) {
    setTip({
      left: Math.min(e.clientX + 14, window.innerWidth - 240),
      top: e.clientY - 10,
      p,
    });
  }

  const labelIdx = n === 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="售价与成本走势图">
        {/* 横向网格 + Y 轴刻度 */}
        {[0, 0.25, 0.5, 0.75, 1].map((r) => {
          const v = min + (1 - r) * (max - min);
          const y = PAD.t + r * (H - PAD.t - PAD.b);
          return (
            <g key={r}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} stroke="#e5e7eb" strokeWidth="1" />
              <text x={PAD.l - 8} y={y + 4} fontSize="11" fill="#9ca3af" textAnchor="end">
                {fmtY(v)}
              </text>
            </g>
          );
        })}

        {/* 参考售价（虚线） */}
        {showRef && (
          <g>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={yOf(refSalePrice)}
              y2={yOf(refSalePrice)}
              stroke="#94a3b8"
              strokeWidth="1.5"
              strokeDasharray="6 4"
            />
            <text x={W - PAD.r - 4} y={yOf(refSalePrice) - 6} fontSize="11" fill="#94a3b8" textAnchor="end">
              参考售价 {fmtY(refSalePrice)}
            </text>
          </g>
        )}

        {/* 当日成本波动区间（最高/最低成本连成着色区域） */}
        {n > 1 && (
          <path d={bandPath} fill={COST} opacity="0.14" stroke={COST} strokeOpacity="0.35" strokeWidth="1" />
        )}

        {/* 基础折线：每日成本点（当日数量加权平均成本） */}
        {n > 1 && <polyline points={costLine} fill="none" stroke={COST} strokeWidth="2" strokeLinejoin="round" />}

        {/* 每日成本点 */}
        {byDay.map((d, i) => (
          <circle key={`c${i}`} cx={xOfDay(i)} cy={yOf(d.avgCost)} r="3" fill={COST} />
        ))}

        {/* 实际售价点（统一灰色，不按客户配色） */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={xOfDay(dayIndex.get(p.dayTs) ?? 0)}
            cy={yOf(p.unitPrice)}
            r={tip?.p === p ? 6 : 4}
            fill={DOT}
            stroke="#ffffff"
            strokeWidth="1.5"
            className="cursor-pointer"
            onMouseEnter={(e) => onDot(e, p)}
            onMouseMove={(e) => onDot(e, p)}
            onMouseLeave={() => setTip(null)}
          />
        ))}

        {/* X 轴日期（首/中/尾） */}
        {labelIdx.map((i) => (
          <text
            key={i}
            x={xOfDay(i)}
            y={H - 6}
            fontSize="11"
            fill="#9ca3af"
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
          >
            {byDay[i].date}
          </text>
        ))}
      </svg>

      {/* 图例 */}
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-2 text-xs text-gray-600">
        {n > 1 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-5 rounded" style={{ background: COST, opacity: 0.15 }} />
            当日成本波动区间（最高~最低）
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5 rounded" style={{ background: COST }} />
          当日成本（数量加权）
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: DOT }} />
          实际售价（每单一点）
        </span>
        {showRef && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0 w-5 border-t-2 border-dashed border-[#94a3b8]" />
            参考售价
          </span>
        )}
      </div>

      {/* 悬停提示 */}
      {tip && (
        <div
          className="pointer-events-none fixed z-50 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg"
          style={{ left: tip.left, top: tip.top }}
        >
          <div className="font-medium text-gray-900">{tip.p.customer}</div>
          <div className="mt-1 space-y-0.5 text-gray-600">
            <div>{tip.p.date} ・ {tip.p.orderNo}</div>
            <div>
              售价 <span className="font-medium text-gray-900">¥{tip.p.unitPrice.toFixed(2)}</span>
              　成本 <span className="font-medium text-[#ea580c]">¥{tip.p.unitCost.toFixed(2)}</span>
            </div>
            <div>
              数量 {tip.p.qty.toFixed(3)} ・ 毛利率{" "}
              <span className={tip.p.profit >= 0 ? "text-green-700" : "text-red-600"}>
                {tip.p.margin.toFixed(1)}%
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
