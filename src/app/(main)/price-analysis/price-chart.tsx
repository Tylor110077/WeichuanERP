"use client";

import { useState, type MouseEvent } from "react";
import type { ColoredPricePoint } from "@/lib/price-analysis";

type ChartPoint = ColoredPricePoint;

const W = 960;
const H = 300;
const PAD = { l: 64, r: 20, t: 18, b: 30 };

/** 售价 × 成本散点折线图：售价点按客户着色，成本（快照）连成折线，虚线为参考售价。 */
export function PriceChart({
  points,
  customerColors,
  refSalePrice,
}: {
  points: ChartPoint[];
  customerColors: { customer: string; color: string }[];
  refSalePrice: number;
}) {
  const [tip, setTip] = useState<{ left: number; top: number; p: ChartPoint } | null>(null);

  if (points.length === 0) return null;

  const prices = points.flatMap((p) => [p.unitPrice, p.unitCost]).filter((v) => v > 0);
  let min = Math.min(...prices);
  let max = Math.max(...prices);
  const span = max - min || Math.max(max * 0.1, 1);
  min = Math.max(min - span * 0.08, 0);
  max = max + span * 0.08;

  const times = points.map((p) => p.ts);
  const one = points.length === 1;
  const t0 = one ? times[0] - 12 * 3600_000 : Math.min(...times);
  const t1 = one ? times[0] + 12 * 3600_000 : Math.max(...times);
  const tSpan = t1 - t0 || 1;

  const xOf = (ts: number) => PAD.l + ((ts - t0) / tSpan) * (W - PAD.l - PAD.r);
  const yOf = (v: number) => H - PAD.b - ((v - min) / (max - min || 1)) * (H - PAD.t - PAD.b);

  const fmtY = (v: number) => (v >= 1000 ? `¥${v.toFixed(0)}` : `¥${v.toFixed(2)}`);
  const showRef = refSalePrice > 0 && refSalePrice >= min && refSalePrice <= max;

  function onDot(e: MouseEvent<SVGCircleElement>, p: ChartPoint) {
    setTip({
      left: Math.min(e.clientX + 14, window.innerWidth - 240),
      top: e.clientY - 10,
      p,
    });
  }

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

        {/* 成本折线 */}
        {points.length > 1 && (
          <polyline
            points={points.map((p) => `${xOf(p.ts).toFixed(1)},${yOf(p.unitCost).toFixed(1)}`).join(" ")}
            fill="none"
            stroke="#f97316"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        )}

        {/* 售价散点（按客户着色） */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={xOf(p.ts)}
            cy={yOf(p.unitPrice)}
            r={tip?.p === p ? 6 : 4}
            fill={p.color}
            stroke="#ffffff"
            strokeWidth="1.5"
            className="cursor-pointer"
            onMouseEnter={(e) => onDot(e, p)}
            onMouseMove={(e) => onDot(e, p)}
            onMouseLeave={() => setTip(null)}
          />
        ))}

        {/* X 轴日期（首/中/尾） */}
        {[t0, t0 + tSpan / 2, t1].map((ts, i) => (
          <text
            key={i}
            x={xOf(ts)}
            y={H - 6}
            fontSize="11"
            fill="#9ca3af"
            textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
          >
            {new Date(ts).toLocaleDateString("zh-CN")}
          </text>
        ))}
      </svg>

      {/* 图例 */}
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-2 text-xs text-gray-600">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5 rounded bg-[#f97316]" />
          成本单价（快照）
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-gray-400" />
          售价（按客户着色）：
        </span>
        {customerColors.map((c) => (
          <span key={c.customer} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
            {c.customer}
          </span>
        ))}
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
                {tip.p.amount > 0 ? ((tip.p.profit / tip.p.amount) * 100).toFixed(1) : "0.0"}%
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
