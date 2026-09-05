"use client";

import { useRouter } from "next/navigation";

export interface PickerProduct {
  id: number;
  code: string;
  name: string;
}

/** 商品选择器：切换即带参跳转，保留当前日期范围。 */
export function ProductPicker({
  products,
  current,
  from,
  to,
}: {
  products: PickerProduct[];
  current: number;
  from?: string;
  to?: string;
}) {
  const router = useRouter();
  function go(id: string) {
    const sp = new URLSearchParams();
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
    if (id) sp.set("productId", id);
    router.push(`/price-analysis?${sp.toString()}`);
  }
  return (
    <select
      value={current ? String(current) : ""}
      onChange={(e) => go(e.target.value)}
      className="min-w-64 rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
      aria-label="选择分析商品"
    >
      <option value="">选择商品…</option>
      {products.map((p) => (
        <option key={p.id} value={p.id}>
          {p.code} {p.name}
        </option>
      ))}
    </select>
  );
}
