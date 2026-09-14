"use client";

import { Fragment, useState, useTransition } from "react";
import Link from "next/link";
import { badgeDanger, badgeMuted, badgeOk } from "@/lib/ui";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { StarToggle } from "@/components/star-toggle";
import { toggleSaleOrderStarAction } from "./actions";

/**
 * 售卖单列表（表头 + 表体）：可逐单展开看商品明细。
 *
 * 为什么是客户端组件：展开/收起是纯交互状态，服务端组件做不到。
 * 明细行用「插入一个 colSpan 的兄弟行」实现，保持表格语义（与应收应付同一套做法）。
 */

export interface SaleOrderRow {
  id: number;
  orderNo: string;
  customerName: string;
  /** confirmed | voided */
  status: string;
  totalAmount: number;
  receivedAmount: number;
  /** 已确认退货的冲减金额 */
  returned: number;
  operatorName: string;
  /** 角色键（admin / sales / boss），展示时查 ROLE_LABELS */
  operatorRole: keyof typeof ROLE_LABELS;
  /** 已格式化的开单时间 */
  createdAtLabel: string;
  starred: boolean;
  /** 还有未收款：详情链接直接落到收款登记处 */
  needsReceipt: boolean;
  items: {
    id: number;
    code: string;
    name: string;
    /** 厂家：卖的是哪家厂里的货 */
    manufacturer: string;
    unit: string;
    qty: number;
    price: number;
    amount: number;
    remark: string;
  }[];
}

const STATUS_LABELS: Record<string, string> = {
  confirmed: "已开单",
  voided: "已作废",
};

const COLS = 9;

export function SaleOrderTable({ rows, children }: { rows: SaleOrderRow[]; children?: React.ReactNode }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  /**
   * 「展开全部」会把当页所有单据的商品行一次渲染出来（20 张单 × 每单商品行）。
   * 用 transition 让它可中断：弱机上点下去不会把界面冻住，按钮也给出「展开中」的反馈。
   */
  const [expanding, startExpand] = useTransition();
  const allOpen = rows.length > 0 && rows.every((r) => expanded.has(r.id));

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      {/* 列多（9 列）：给表格一个最小宽度，宁可窄屏左右滑动，也不要把每格压成六七行 */}
      <table className="w-full min-w-[72rem] divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50 text-left text-xs text-gray-500">
          <tr>
            <th className="w-24 whitespace-nowrap px-4 py-3">
              {rows.length > 0 && (
                <button
                  type="button"
                  onClick={() => startExpand(() => setExpanded(allOpen ? new Set() : new Set(rows.map((r) => r.id))))}
                  title={allOpen ? "全部收起" : "全部展开"}
                  className="whitespace-nowrap text-xs text-blue-600 hover:underline"
                >
                  {allOpen ? "收起" : expanding ? "展开中…" : "展开"}
                </button>
              )}
              <span className="ml-2 font-medium">单据号</span>
            </th>
            <th className="whitespace-nowrap px-4 py-3 font-medium">客户</th>
            <th className="whitespace-nowrap px-4 py-3 font-medium">状态</th>
            <th className="whitespace-nowrap px-4 py-3 font-medium tabular-nums">金额</th>
            <th className="whitespace-nowrap px-4 py-3 font-medium tabular-nums">已收</th>
            <th className="whitespace-nowrap px-4 py-3 font-medium">款项</th>
            <th className="whitespace-nowrap px-4 py-3 font-medium">操作人</th>
            <th className="whitespace-nowrap px-4 py-3 font-medium">开单时间</th>
            <th className="whitespace-nowrap px-4 py-3 font-medium"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 [&>tr]:transition-colors [&>tr:hover]:bg-gray-100/70">
          {rows.length === 0 && (
            <tr>
              <td colSpan={COLS} className="px-4 py-10 text-center">
                <div className="text-sm font-medium text-gray-500">还没有售卖单</div>
                <div className="mt-1 text-xs text-gray-400">点右上角「新建售卖单」开始开单</div>
                <Link href="/sale-orders/new" className="mt-3 inline-block text-xs text-blue-600 hover:underline">
                  + 新建售卖单
                </Link>
              </td>
            </tr>
          )}
          {rows.map((o) => {
            const open = expanded.has(o.id);
            const outstanding = o.totalAmount - o.receivedAmount - o.returned;
            return (
              /* key 必须在 map 返回的最外层元素上：这里最外层是 Fragment（里面含"主行 + 展开行"两行），
                 加在里面那个 <tr> 上 React 看不到，会报 "Each child in a list should have a unique key" */
              <Fragment key={o.id}>
                <tr>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setExpanded((prev) => {
                            const next = new Set(prev);
                            if (next.has(o.id)) next.delete(o.id);
                            else next.add(o.id);
                            return next;
                          })
                        }
                        aria-expanded={open}
                        title={open ? "收起商品" : "展开该单商品"}
                        className="shrink-0 rounded px-0.5 text-xs text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
                      >
                        <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
                      </button>
                      <StarToggle id={o.id} starred={o.starred} toggle={toggleSaleOrderStarAction} />
                      <span className="font-medium text-gray-900">{o.orderNo}</span>
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-900">{o.customerName}</td>
                  <td className="px-4 py-2.5">
                    <span className={o.status === "confirmed" ? badgeOk : badgeMuted}>{STATUS_LABELS[o.status]}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-900 tabular-nums">¥{o.totalAmount.toFixed(2)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-600 tabular-nums">¥{o.receivedAmount.toFixed(2)}</td>
                  <td className="px-4 py-2.5">
                    {o.status === "voided" ? (
                      <span className="text-xs text-gray-400">—</span>
                    ) : outstanding <= 0 ? (
                      <span className={badgeOk}>已结清</span>
                    ) : (
                      <span className={`whitespace-nowrap ${badgeDanger}`}>未结清 ¥{outstanding.toFixed(2)}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">
                    {o.operatorName}（{ROLE_LABELS[o.operatorRole]}）
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">{o.createdAtLabel}</td>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/sale-orders/${o.id}${o.needsReceipt ? "#receipt" : ""}`}
                      className="whitespace-nowrap text-blue-600 hover:underline"
                      title={o.needsReceipt ? "打开单据详情，并直接跳到收款登记处" : "打开单据详情"}
                    >
                      详情 / 登记
                    </Link>
                  </td>
                </tr>
                {open && (
                  <tr key={`${o.id}-items`} className="bg-gray-50/60">
                    <td colSpan={COLS} className="px-4 py-3">
                      {o.items.length === 0 ? (
                        <span className="text-xs text-gray-400">该单没有商品行</span>
                      ) : (
                        <table className="w-full table-fixed text-xs">
                          <thead className="text-left text-gray-500">
                            <tr>
                              <th className="w-[6.5rem] py-1 font-medium">编码</th>
                              <th className="w-[20%] py-1 font-medium">品名</th>
                              <th className="w-[11%] py-1 font-medium">厂家</th>
                              <th className="w-[3.5rem] py-1 font-medium">单位</th>
                              <th className="w-[6rem] py-1 text-right font-medium tabular-nums">数量</th>
                              <th className="w-[6.5rem] py-1 text-right font-medium tabular-nums">单价</th>
                              <th className="w-[7rem] py-1 text-right font-medium tabular-nums">金额</th>
                              <th className="w-[13%] py-1 font-medium">备注</th>
                            </tr>
                          </thead>
                          <tbody className="text-gray-800">
                            {o.items.map((it) => (
                              <tr key={it.id} className="border-t border-gray-100">
                                <td className="truncate py-1 text-gray-600">{it.code}</td>
                                <td className="truncate py-1">{it.name}</td>
                                <td className="truncate py-1 text-gray-600">{it.manufacturer || "—"}</td>
                                <td className="py-1 text-gray-600">{it.unit}</td>
                                <td className="py-1 text-right tabular-nums">{it.qty.toFixed(3)}</td>
                                <td className="py-1 text-right tabular-nums">¥{it.price.toFixed(2)}</td>
                                <td className="py-1 text-right tabular-nums">¥{it.amount.toFixed(2)}</td>
                                <td className="truncate py-1 text-gray-500">{it.remark || "—"}</td>
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
      {/* 分页条等由页面作为 slot 传进来（服务端渲染，不必进这个客户端组件） */}
      {children}
    </div>
  );
}
