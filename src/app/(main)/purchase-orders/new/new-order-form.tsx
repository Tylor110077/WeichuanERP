"use client";

import { useActionState, useState } from "react";
import { createPurchaseOrderAction, type FormState } from "../actions";

interface SupplierOption {
  id: number;
  name: string;
}

interface ProductOption {
  id: number;
  label: string;
  unitId: number;
  unitName: string;
  refPrice: number;
}

interface Row {
  productId: string;
  unitName: string;
  quantity: string;
  unitPrice: string;
}

const inputCls =
  "w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm";

export function NewOrderForm({
  suppliers,
  products,
}: {
  suppliers: SupplierOption[];
  products: ProductOption[];
}) {
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [supplierId, setSupplierId] = useState("");
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createPurchaseOrderAction,
    null
  );

  function emptyRow(): Row {
    return { productId: "", unitName: "", quantity: "", unitPrice: "" };
  }

  function onProductChange(index: number, productId: string) {
    const p = products.find((x) => String(x.id) === productId);
    setRows((prev) =>
      prev.map((row, i) =>
        i === index
          ? {
              ...row,
              productId,
              unitName: p ? `${p.unitName}` : "",
              unitPrice: p ? String(p.refPrice) : "",
            }
          : row
      )
    );
  }

  function lineAmount(row: Row): number {
    const q = Number(row.quantity);
    const price = Number(row.unitPrice);
    return Number.isFinite(q) && Number.isFinite(price) ? q * price : 0;
  }

  const total = rows.reduce((s, r) => s + lineAmount(r), 0);

  return (
    <form action={formAction} className="space-y-4">
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-gray-200 bg-white p-5">
        <div className="min-w-56">
          <label htmlFor="supplierId" className="block text-xs font-medium text-gray-600">
            供应商 *
          </label>
          <select
            id="supplierId"
            name="supplierId"
            required
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className={`mt-1 ${inputCls}`}
          >
            <option value="">请选择供应商</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-56 flex-1">
          <label htmlFor="remark" className="block text-xs font-medium text-gray-600">
            备注
          </label>
          <input
            id="remark"
            name="remark"
            type="text"
            maxLength={200}
            placeholder="选填"
            className={`mt-1 ${inputCls}`}
          />
        </div>
        <div className="text-right text-sm text-gray-600">
          合计：<span className="text-base font-semibold text-gray-900">¥{total.toFixed(2)}</span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">商品 *</th>
              <th className="w-32 px-4 py-3 font-medium">数量 *</th>
              <th className="w-24 px-4 py-3 font-medium">单位</th>
              <th className="w-36 px-4 py-3 font-medium">进价 *</th>
              <th className="w-32 px-4 py-3 text-right font-medium">金额</th>
              <th className="w-16 px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row, i) => (
              <tr key={i}>
                <td className="px-4 py-2">
                  <select
                    name={`item_${i}_productId`}
                    required
                    value={row.productId}
                    onChange={(e) => onProductChange(i, e.target.value)}
                    className={inputCls}
                  >
                    <option value="">请选择商品</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-2">
                  <input
                    name={`item_${i}_quantity`}
                    type="number"
                    min="0.001"
                    step="0.001"
                    required
                    value={row.quantity}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((r, j) => (j === i ? { ...r, quantity: e.target.value } : r))
                      )
                    }
                    className={inputCls}
                  />
                </td>
                <td className="px-4 py-2 text-gray-600">{row.unitName || "—"}</td>
                <td className="px-4 py-2">
                  <input
                    name={`item_${i}_unitPrice`}
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={row.unitPrice}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((r, j) => (j === i ? { ...r, unitPrice: e.target.value } : r))
                      )
                    }
                    className={inputCls}
                  />
                </td>
                <td className="px-4 py-2 text-right text-gray-900">
                  {lineAmount(row).toFixed(2)}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => setRows((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev))}
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
          <button
            type="button"
            onClick={() => setRows((prev) => [...prev, emptyRow()])}
            className="text-sm text-blue-600 hover:underline"
          >
            + 添加商品行
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending || !supplierId}
          className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? "提交中…" : "提交进货单"}
        </button>
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      </div>
    </form>
  );
}
