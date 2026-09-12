"use client";

import { useActionState, useState } from "react";
import { btnWarnSolid, btnSmallSolid, inputBase } from "@/lib/ui";
import { createSaleReturnAction } from "@/app/(main)/sale-returns/actions";
import { createPurchaseReturnAction } from "@/app/(main)/purchase-returns/actions";
import type { FormState } from "@/app/(main)/sale-returns/actions";

/**
 * 退货单表单（客户退货 / 厂家退货共用一份实现）。
 *
 * 业务约定（用户明确要求，两处必须一致，所以不给两边各写一份）：
 * - **不填就是不退**：退货数量留空或填 0，这一行就不退；
 *   想只退其中几样时，其余行留空直接提交即可（不必先删行）。
 * - **不允许负数**：输入框挡住负号，服务端也会再校验一次。
 * - **快捷「全部退」**：一键把每行填成它的可退数量；「清空」用于反悔重填。
 * - 超出可退数量：一边输入一边给红字提示，失焦时自动收到上限，服务端另有兜底校验。
 *
 * 两个方向只有三处不同：提交的 action、隐藏的原单 id 字段名、冲减应收/应付的文案。
 */

export interface ReturnRowOption {
  orderItemId: number;
  code: string;
  name: string;
  unitName: string;
  quantity: number;
  unitPrice: number;
  remaining: number;
}

interface Row {
  orderItemId: string;
  label: string;
  unitName: string;
  max: number;
  quantity: string;
  unitPrice: string;
}

const cellInput = `${inputBase} w-full`;

function fmt(n: number): string {
  return n.toFixed(3);
}

/** 行上已有的数量（用于金额与"是否要退"的判断）；空串/非法值按 0 计 */
function rowQty(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function ReturnForm({
  direction,
  orderId,
  rows,
}: {
  direction: "sale" | "purchase";
  orderId: number;
  rows: ReturnRowOption[];
}) {
  // 默认把原单里「还有可退数量」的行全部带出来（数量留空＝不退，避免误提交）：
  // 用户是从那张单点「退货」进来的，不该再让他从下拉里挑一次商品。
  const [lines, setLines] = useState<Row[]>(() =>
    rows
      .filter((r) => r.remaining > 0)
      .map((r) => ({
        orderItemId: String(r.orderItemId),
        label: `${r.code} ${r.name}`,
        unitName: r.unitName,
        max: r.remaining,
        quantity: "",
        unitPrice: String(r.unitPrice),
      }))
  );
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    direction === "sale" ? createSaleReturnAction : createPurchaseReturnAction,
    null
  );

  function patch(index: number, next: Partial<Row>) {
    setLines((prev) => prev.map((row, i) => (i === index ? { ...row, ...next } : row)));
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      { orderItemId: "", label: "", unitName: "", max: 0, quantity: "", unitPrice: "" },
    ]);
  }

  function onSelect(index: number, orderItemId: string) {
    const opt = rows.find((r) => String(r.orderItemId) === orderItemId);
    patch(index, {
      orderItemId,
      label: opt ? `${opt.code} ${opt.name}` : "",
      unitName: opt?.unitName ?? "",
      max: opt?.remaining ?? 0,
      quantity: "",
      unitPrice: opt ? String(opt.unitPrice) : "",
    });
  }

  /** 数量输入：挡住负号；超出可退数量只在失焦时收到上限（输入过程中不打断） */
  function onQtyChange(index: number, raw: string) {
    if (raw.startsWith("-")) return; // 不允许负数：直接不接受这次输入
    patch(index, { quantity: raw });
  }

  function onQtyBlur(index: number) {
    const line = lines[index];
    const q = rowQty(line.quantity);
    if (q > line.max) patch(index, { quantity: fmt(line.max) });
  }

  /** 全部退：把每一行都填成它的可退数量（跳到无可退的行） */
  function returnAll() {
    setLines((prev) => prev.map((row) => (row.max > 0 ? { ...row, quantity: fmt(row.max) } : row)));
  }

  /** 清空：所有数量置空＝整单不退（用来反悔重填） */
  function clearAll() {
    setLines((prev) => prev.map((row) => ({ ...row, quantity: "" })));
  }

  function lineAmount(line: Row): number {
    return rowQty(line.quantity) * (Number(line.unitPrice) || 0);
  }

  const activeCount = lines.filter((l) => rowQty(l.quantity) > 0).length;
  const total = lines.reduce((s, l) => s + lineAmount(l), 0);
  const offsetLabel = direction === "sale" ? "冲减应收" : "冲减应付";
  const idField = direction === "sale" ? "saleOrderId" : "purchaseOrderId";

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name={idField} value={orderId} />
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="whitespace-nowrap px-4 py-3 font-medium">原单商品</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">可退数量</th>
              <th className="w-36 px-4 py-3 font-medium">
                退货数量
                <span className="ml-1 font-normal text-gray-400">不填＝不退</span>
              </th>
              <th className="w-16 px-4 py-3 font-medium">单位</th>
              <th className="w-36 px-4 py-3 font-medium">退货价</th>
              <th className="w-28 px-4 py-3 text-right font-medium tabular-nums">金额</th>
              <th className="w-14 px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 [&>tr]:transition-colors [&>tr:hover]:bg-gray-100/70">
            {lines.map((line, i) => {
              const over = rowQty(line.quantity) > line.max;
              return (
                <tr key={i}>
                  <td className="px-4 py-2">
                    <select
                      name={`item_${i}_orderItemId`}
                      value={line.orderItemId}
                      onChange={(e) => onSelect(i, e.target.value)}
                      className={cellInput}
                    >
                      <option value="">请选择原单商品（不选＝此行不用）</option>
                      {rows
                        .filter((r) => r.remaining > 0)
                        .map((r) => (
                          <option key={r.orderItemId} value={r.orderItemId}>
                            {r.code} {r.name}（可退 {fmt(r.remaining)}）
                          </option>
                        ))}
                    </select>
                  </td>
                  <td className="px-4 py-2 text-gray-600">{line.max ? fmt(line.max) : "—"}</td>
                  <td className="px-4 py-2">
                    <input
                      name={`item_${i}_quantity`}
                      type="number"
                      min="0"
                      max={line.max || undefined}
                      step="0.001"
                      inputMode="decimal"
                      placeholder="不填＝不退"
                      value={line.quantity}
                      onChange={(e) => onQtyChange(i, e.target.value)}
                      onBlur={() => onQtyBlur(i)}
                      className={cellInput}
                    />
                    {over && (
                      <p className="mt-1 text-xs text-red-600">
                        最多可退 {fmt(line.max)}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2 text-gray-600">{line.unitName || "—"}</td>
                  <td className="px-4 py-2">
                    <input
                      name={`item_${i}_unitPrice`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.unitPrice}
                      onChange={(e) => patch(i, { unitPrice: e.target.value })}
                      className={cellInput}
                    />
                  </td>
                  <td className="px-4 py-2 text-right text-gray-900 tabular-nums">
                    {lineAmount(line).toFixed(2)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    <button
                      type="button"
                      onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                      className="whitespace-nowrap text-xs text-red-500 hover:underline"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 px-4 py-3">
          <button type="button" onClick={addLine} className="text-sm text-blue-600 hover:underline">
            + 添加退货行
          </button>
          <button type="button" onClick={returnAll} className={btnSmallSolid}>
            全部退
          </button>
          <button
            type="button"
            onClick={clearAll}
            className="text-sm text-gray-500 hover:text-gray-700 hover:underline"
          >
            清空
          </button>
          <span className="text-xs text-gray-400">
            「全部退」把每行填成它的可退数量；只想退其中几样时，其余行留空即可
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-gray-600">
          {offsetLabel}：
          <span className="text-base font-semibold text-gray-900">¥{total.toFixed(2)}</span>
          <span className="ml-2 text-xs text-gray-400">
            本次退 {activeCount} 行
            {lines.length > activeCount && `，其余 ${lines.length - activeCount} 行未退`}
          </span>
        </span>
        <button type="submit" disabled={pending || activeCount === 0} className={btnWarnSolid}>
          {pending ? "提交中…" : "确认退货"}
        </button>
        {activeCount === 0 && (
          <span className="text-xs text-gray-500">
            还没填退货数量：填了才会退，不退货的行留空即可
          </span>
        )}
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      </div>
    </form>
  );
}
