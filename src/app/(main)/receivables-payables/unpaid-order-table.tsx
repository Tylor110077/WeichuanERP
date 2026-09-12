"use client";

import { Fragment, useState } from "react";
import Link from "next/link";

/**
 * 未结清单据表（可展开看单据里的商品）。
 *
 * 为什么是客户端组件：展开/收起是纯交互状态，服务端组件做不到；
 * 但数据仍由服务端一次性取好（当前页 ≤50 张单，附带各自明细），不在前端二次请求。
 *
 * 行内展开用「插入一个 colSpan 的明细行」实现，保持表格语义（而不是把表格拆成卡片）。
 */

export interface OrderItemRow {
  id: number;
  code: string;
  name: string;
  unit: string;
  qty: number;
  price: number;
  amount: number;
  remark: string;
}

export interface UnpaidOrderRow {
  id: number;
  orderNo: string;
  date: string;
  counterName: string;
  total: number;
  paid: number;
  returned: number;
  unpaid: number;
  detailHref: string;
  items: OrderItemRow[];
}

export function UnpaidOrderTable({
  rows,
  labels,
}: {
  rows: UnpaidOrderRow[];
  labels: { total: string; paid: string };
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allOpen = rows.length > 0 && rows.every((r) => expanded.has(r.id));

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      {/* 列多（开关 + 8 列）：给最小宽度，宁可窄屏左右滑动，也不要把「展开」压成竖排、
            把商品概览挤成四行。实测 60rem 时行高回到 41px、商品列 67px→132px。 */}
      <table className="min-w-[60rem] divide-y divide-gray-200 text-sm [&_td]:align-top">
        <thead className="bg-gray-50 text-left text-xs text-gray-500">
          <tr>
            <th className="w-20 px-4 py-3">
              <button
                type="button"
                onClick={() =>
                  setExpanded(allOpen ? new Set() : new Set(rows.map((r) => r.id)))
                }
                title={allOpen ? "全部收起" : "全部展开"}
                className="whitespace-nowrap text-xs text-blue-600 hover:underline"
              >
                {allOpen ? "收起" : "展开"}
              </button>
            </th>
            <th className="whitespace-nowrap px-4 py-3 font-medium">日期</th>
            <th className="whitespace-nowrap px-4 py-3 font-medium">单号</th>
            <th className="whitespace-nowrap px-4 py-3 font-medium">商品</th>
            <th className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">{labels.total}</th>
            <th className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">{labels.paid}</th>
            <th className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">退货冲减</th>
            <th className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">
              {labels.total === "应收" ? "未收" : "未付"}
            </th>
            <th className="whitespace-nowrap px-4 py-3 font-medium"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 [&>tr]:transition-colors [&>tr:hover]:bg-gray-100/70">
          {rows.map((o) => {
            const open = expanded.has(o.id);
            return (
              // React 要求 key 落在 map 返回的最外层元素上：裸 <> 分片承载不了 key，
              // 会报 "Each child in a list should have a unique key"（开发浮层里那条 1 Issue）
              <Fragment key={o.id}>
                <tr>
                  <td className="px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => toggle(o.id)}
                      aria-expanded={open}
                      title={open ? "收起商品" : "展开该单商品"}
                      className="flex items-center gap-1 whitespace-nowrap text-xs text-gray-500 hover:text-blue-600"
                    >
                      <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
                      {open ? "收起" : "展开"}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 tabular-nums">{o.date}</td>
                  <td className="px-4 py-2.5">
                    <Link href={o.detailHref} className="font-medium text-blue-600 hover:underline">
                      {o.orderNo}
                    </Link>
                  </td>
                  {/* 未展开时给一个"含 N 种商品"的概览，便于判断要不要展开 */}
                  <td className="px-4 py-2.5 text-gray-600">
                    {open ? (
                      <span className="text-xs text-gray-400">见下方明细</span>
                    ) : (
                      <span className="text-xs text-gray-500">
                        {o.items.length} 种
                        {o.items.length > 0 && (
                          <span className="ml-1 text-gray-400">
                            {o.items
                              .slice(0, 2)
                              .map((it) => it.name)
                              .join("、")}
                            {o.items.length > 2 ? "…" : ""}
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-900 tabular-nums">¥{o.total.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600 tabular-nums">¥{o.paid.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-right text-orange-600 tabular-nums">¥{o.returned.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-red-600 tabular-nums">
                    ¥{o.unpaid.toFixed(2)}
                  </td>
                  <td className="px-4 py-2.5">
                    <Link href={o.detailHref} className="whitespace-nowrap text-xs text-blue-600 hover:underline">
                      详情 / 登记
                    </Link>
                  </td>
                </tr>
                {open && (
                  <tr key={`${o.id}-items`} className="bg-gray-50/60">
                    <td colSpan={9} className="px-4 py-3">
                      {o.items.length === 0 ? (
                        <p className="text-xs text-gray-400">该单没有商品明细</p>
                      ) : (
                        <table className="min-w-full text-xs">
                          <thead className="text-left text-gray-500">
                            <tr>
                              <th className="py-1 pr-4 font-medium">编码</th>
                              <th className="py-1 pr-4 font-medium">品名</th>
                              <th className="py-1 pr-4 font-medium">单位</th>
                              <th className="py-1 pr-4 text-right font-medium">数量</th>
                              <th className="py-1 pr-4 text-right font-medium">单价</th>
                              <th className="py-1 pr-4 text-right font-medium">金额</th>
                              <th className="py-1 font-medium">备注</th>
                            </tr>
                          </thead>
                          <tbody className="text-gray-800">
                            {o.items.map((it) => (
                              <tr key={it.id}>
                                <td className="py-1 pr-4 text-gray-600">{it.code}</td>
                                <td className="py-1 pr-4">{it.name}</td>
                                <td className="py-1 pr-4 text-gray-600">{it.unit}</td>
                                <td className="py-1 pr-4 text-right tabular-nums">{it.qty.toFixed(3)}</td>
                                <td className="py-1 pr-4 text-right tabular-nums">¥{it.price.toFixed(2)}</td>
                                <td className="py-1 pr-4 text-right tabular-nums">¥{it.amount.toFixed(2)}</td>
                                <td className="py-1 text-gray-500">{it.remark || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
