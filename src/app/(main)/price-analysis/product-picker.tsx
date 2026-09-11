"use client";

import { useRouter } from "next/navigation";
import { SearchSelect } from "@/components/search-select";

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
    <SearchSelect
      key={`picker-${current}`}
      name="productPicker"
      options={products.map((p) => ({ value: String(p.id), label: `${p.code} ${p.name}` }))}
      defaultValue={current ? String(current) : ""}
      noneLabel="选择商品…"
      placeholder="商品（可搜索）"
      className="min-w-64"
      onChange={go}
    />
  );
}
