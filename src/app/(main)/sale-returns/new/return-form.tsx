"use client";

import { useActionState, useState } from "react";
import { createSaleReturnAction, type FormState } from "../actions";

interface RowOption {
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

const inputCls = "w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm";

export function ReturnForm({
  saleOrderId,
  rows,
}: {
  saleOrderId: number;
  rows: RowOption[];
}) {
  const [lines, setLines] = useState<Row[]>([]);
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createSaleReturnAction,
    null
  );

  function addLine() {
    setLines((prev) => [
      ...prev,
      { orderItemId: "", label: "", unitName: "", max: 0, quantity: "", unitPrice: "" },
    ]);
  }

  function onSelect(index: number, orderItemId: string) {
    const opt = rows.find((r) => String(r.orderItemId) === orderItemId);
    setLines((prev) =>
      prev.map((row, i) =>
        i === index
          ? {
              ...row,
              orderItemId,
              label: opt ? `${opt.code} ${opt.name}` : "",
              unitName: opt?.unitName ?? "",
              max: opt?.remaining ?? 0,
              quantity: "",
              unitPrice: opt ? String(opt.unitPrice) : "",
            }
          : row
      )
    );
  }

  function lineAmount(line: Row): number {
    const q = Number(line.quantity);
    const p = Number(line.unitPrice);
    return Number.isFinite(q) && Number.isFinite(p) ? q * p : 0;
  }
  const total = lines.reduce((s, l) => s + lineAmount(l), 0);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="saleOrderId" value={saleOrderId} />
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">原单商品 *</th>
              <th className="px-4 py-3 font-medium">可退数量</th>
              <th className="w-32 px-4 py-3 font-medium">退货数量 *</th>
              <th className="w-16 px-4 py-3 font-medium">单位</th>
              <th className="w-36 px-4 py-3 font-medium">退货价 *</th>
              <th className="w-28 px-4 py-3 text-right font-medium">金额</th>
              <th className="w-14 px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {lines.map((line, i) => (
              <tr key={i}>
                <td className="px-4 py-2">
                  <select
                    name={`item_${i}_orderItemId`}
                    required
                    value={line.orderItemId}
                    onChange={(e) => onSelect(i, e.target.value)}
                    className={inputCls}
                  >
                    <option value="">请选择原单商品</option>
                    {rows
                      .filter((r) => r.remaining > 0)
                      .map((r) => (
                        <option key={r.orderItemId} value={r.orderItemId} disabled={r.remaining <= 0}>
                          {r.code} {r.name}（可退 {r.remaining.toFixed(3)}）
                        </option>
                      ))}
                  </select>
                </td>
                <td className="px-4 py-2 text-gray-600">{line.max ? line.max.toFixed(3) : "—"}</td>
                <td className="px-4 py-2">
                  <input
                    name={`item_${i}_quantity`}
                    type="number"
                    min="0.001"
                    max={line.max || undefined}
                    step="0.001"
                    required
                    value={line.quantity}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((r, j) => (j === i ? { ...r, quantity: e.target.value } : r))
                      )
                    }
                    className={inputCls}
                  />
                </td>
                <td className="px-4 py-2 text-gray-600">{line.unitName || "—"}</td>
                <td className="px-4 py-2">
                  <input
                    name={`item_${i}_unitPrice`}
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={line.unitPrice}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((r, j) => (j === i ? { ...r, unitPrice: e.target.value } : r))
                      )
                    }
                    className={inputCls}
                  />
                </td>
                <td className="px-4 py-2 text-right text-gray-900">{lineAmount(line).toFixed(2)}</td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                    className="text-xs text-red-500 hover:underline"
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-gray-100 px-4 py-3">
          <button type="button" onClick={addLine} className="text-sm text-blue-600 hover:underline">
            + 添加退货行
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-600">
          冲减应收：<span className="text-base font-semibold text-gray-900">¥{total.toFixed(2)}</span>
        </span>
        <button
          type="submit"
          disabled={pending || lines.length === 0}
          className="rounded-md bg-orange-500 px-5 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50"
        >
          {pending ? "提交中…" : "确认退货"}
        </button>
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      </div>
    </form>
  );
}
