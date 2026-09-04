/**
 * 铜价折线图（纯 SVG，无图表库依赖）：
 * - 14 天日价趋势（日期 × 价格）
 * - 当日时点趋势（时间 × 价格，若该日有录入时点）
 */

interface Point {
  label: string;
  price: number;
}

function buildPath(points: Point[], width: number, height: number, pad: number): string {
  const min = Math.min(...points.map((p) => p.price));
  const max = Math.max(...points.map((p) => p.price));
  const span = max - min || 1;
  return points
    .map((p, i) => {
      const x = pad + (i / Math.max(points.length - 1, 1)) * (width - pad * 2);
      const y = height - pad - ((p.price - min) / span) * (height - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function buildAreaPath(points: Point[], width: number, height: number, pad: number): string {
  const line = buildPath(points, width, height, pad);
  const lastX = pad + (width - pad * 2);
  const firstX = pad;
  const bottom = height - pad;
  return `${line} L${lastX.toFixed(1)},${bottom} L${firstX.toFixed(1)},${bottom} Z`;
}

export function CuPriceChart({
  points,
  height = 230,
  width = 900,
  label = "铜价（元/吨）",
}: {
  points: Point[];
  height?: number;
  width?: number;
  label?: string;
}) {
  if (points.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-gray-400">
        暂无行情数据（请管理员到「行情管理」录入）
      </div>
    );
  }
  const pad = 28;
  const min = Math.min(...points.map((p) => p.price));
  const max = Math.max(...points.map((p) => p.price));
  const span = max - min || 1;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      role="img"
      aria-label={`${label}，最低 ${min.toFixed(2)}，最高 ${max.toFixed(2)}`}
    >
      {/* 网格 */}
      {[0.25, 0.5, 0.75].map((r) => (
        <line
          key={r}
          x1={pad}
          x2={width - pad}
          y1={height - pad - r * (height - pad * 2)}
          y2={height - pad - r * (height - pad * 2)}
          stroke="#e5e7eb"
          strokeWidth="1"
        />
      ))}
      {/* 面积 + 折线 */}
      <path d={buildAreaPath(points, width, height, pad)} fill="#dbeafe" opacity="0.6" />
      <path
        d={buildPath(points, width, height, pad)}
        fill="none"
        stroke="#2563eb"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* 首尾/极值标注 */}
      <text x={pad} y={pad - 10} fontSize="13" fontWeight="600" fill="#374151">
        ¥{max.toFixed(0)}
      </text>
      <text x={pad} y={height - pad + 18} fontSize="13" fontWeight="600" fill="#374151">
        ¥{min.toFixed(0)}
      </text>
      {/* X 轴标签（首/中/尾） */}
      {[0, Math.floor((points.length - 1) / 2), points.length - 1]
        .filter((idx, i, arr) => arr.indexOf(idx) === i)
        .map((idx) => {
          const x = pad + (idx / Math.max(points.length - 1, 1)) * (width - pad * 2);
          return (
            <text
              key={idx}
              x={x}
              y={height - 4}
              fontSize="12"
              fill="#9ca3af"
              textAnchor="middle"
            >
              {points[idx].label}
            </text>
          );
        })}
      {/* 最新点 */}
      <circle
        cx={pad + (width - pad * 2)}
        cy={height - pad - ((points[points.length - 1].price - min) / span) * (height - pad * 2)}
        r="3.5"
        fill="#2563eb"
      />
    </svg>
  );
}
