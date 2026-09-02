"use client";

import { useActionState, useState } from "react";
import { createSaleOrderAction, type FormState } from "../actions";

interface CustomerOption {
  id: number;
  name: string;
}
interface SupplierOption {
  id: number;
  name: string;
}
interface ProductOption {
  id: number;
  label: string;
  unitName: string;
  stockQty: number;
  refSalePrice: number;
  lastSupplierId: number | null;
  lastSupplyPrice: number;
}

interface Row {
  productId: string;
  unitName: string;
  stockQty: number;
  quantity: string;
  unitPrice: string;
  supplierId: string;
  supplyPrice: string;
  hasLastSupplier: boolean;
}

const inputCls = "w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm";

export function NewSaleForm({
  customers,
  suppliers,
  products,
}: {
  customers: CustomerOption[];
  suppliers: SupplierOption[];
  products: ProductOption[];
}) {
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [customerId, setCustomerId] = useState("");
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createSaleOrderAction,
    null
  );

  function emptyRow(): Row {
    return {
      productId: "",
      unitName: "",
      stockQty: 0,
      quantity: "",
      unitPrice: "",
      supplierId: "",
      supplyPrice: "",
      hasLastSupplier: false,
    };
  }

  function onProductChange(index: number, productId: string) {
    const p = products.find((x) => String(x.id) === productId);
    setRows((prev) =>
      prev.map((row, i) =>
        i === index
          ? {
              ...row,
              productId,
              unitName: p ? p.unitName : "",
              stockQty: p ? p.stockQty : 0,
              unitPrice: p ? String(p.refSalePrice) : "",
              supplierId: p?.lastSupplierId != null ? String(p.lastSupplierId) : "",
              supplyPrice: p ? String(p.lastSupplyPrice) : "",
              hasLastSupplier: p?.lastSupplierId != null,
            }
          : row
      )
    );
  }

  function shortfall(row: Row): number {
    const q = Number(row.quantity);
    if (!Number.isFinite(q) || q <= 0) return 0;
    return Math.max(q - row.stockQty, 0);
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
          <label htmlFor="customerId" className="block text-xs font-medium text-gray-600">
            客户 *
          </label>
          <select
            id="customerId"
            name="customerId"
            required
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className={`mt-1 ${inputCls}`}
          >
            <option value="">请选择客户</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-56 flex-1">
          <label htmlFor="sale-remark" className="block text-xs font-medium text-gray-600">
            备注
          </label>
          <input
            id="sale-remark"
            name="remark"
            type="text"
            maxLength={200}
            placeholder="选填"
            className={`mt-1 ${inputCls}`}
          />
        </div>
        <div className="text-right text-sm text-gray-600">
          合计：
          <span className="text-base font-semibold text-gray-900">¥{total.toFixed(2)}</span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">商品 *</th>
              <th className="w-20 px-4 py-3 font-medium">库存</th>
              <th className="w-28 px-4 py-3 font-medium">数量 *</th>
              <th className="w-16 px-4 py-3 font-medium">单位</th>
              <th className="w-32 px-4 py-3 font-medium">售价 *</th>
              <th className="w-48 px-4 py-3 font-medium">自动补货（缺货时）</th>
              <th className="w-28 px-4 py-3 text-right font-medium">金额</th>
              <th className="w-14 px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row, i) => {
              const sf = shortfall(row);
              return (
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
                  <td className="px-4 py-2 text-gray-600">{row.unitName ? row.stockQty.toFixed(3) : "—"}</td>
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
                  <td className="px-4 py-2">
                    {sf > 0 ? (
                      <div className="flex items-center gap-1">
                        <select
                          name={`item_${i}_supplierId`}
                          required={sf > 0}
                          value={row.supplierId}
                          onChange={(e) =>
                            setRows((prev) =>
                              prev.map((r, j) => (j === i ? { ...r, supplierId: e.target.value } : r))
                            )
                          }
                          className={`${inputCls} max-w-28`}
                        >
                          <option value="">补货供应商</option>
                          {suppliers.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                        <input
                          name={`item_${i}_supplyPrice`}
                          type="number"
                          min="0"
                          step="0.01"
                          required={sf > 0}
                          value={row.supplyPrice}
                          onChange={(e) =>
                            setRows((prev) =>
                              prev.map((r, j) => (j === i ? { ...r, supplyPrice: e.target.value } : r))
                            )
                          }
                          className={`${inputCls} max-w-20`}
                        />
                        <span className="whitespace-nowrap text-xs text-amber-600">
                          缺 {sf.toFixed(3)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">
                        {row.hasLastSupplier ? "" : row.productId ? "库存充足" : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-900">{lineAmount(row).toFixed(2)}</td>
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
              );
            })}
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
          disabled={pending || !customerId}
          className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? "提交中…" : "提交售卖单"}
        </button>
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state?.ok && <p className="text-sm text-green-600">{state.ok}</p>}
      </div>
    </form>
  );
}
