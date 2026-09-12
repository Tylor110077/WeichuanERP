"use client";

import { useRouter } from "next/navigation";
import { initials } from "@/lib/pinyin";
import { SearchSelect } from "@/components/search-select";

export interface PickerProduct {
  id: number;
  code: string;
  name: string;
  /** 厂家：不同厂家会有同名商品，候选项里要标出来才能分清 */
  manufacturer: string;
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
      // 候选项后面备注厂家：「P001079 BV（渝丰）」——同名不同厂家时才分得清；
      // 拼音串也带上厂家，输入「jn」就能筛到金牛的货
      options={products.map((p) => ({
        value: String(p.id),
        label: `${p.code} ${p.name}（${p.manufacturer || "未填厂家"}）`,
        py: initials(`${p.code} ${p.name} ${p.manufacturer}`),
      }))}
      defaultValue={current ? String(current) : ""}
      noneLabel="选择商品…"
      placeholder="商品（可搜索）"
      className="min-w-64"
      onChange={go}
    />
  );
}
