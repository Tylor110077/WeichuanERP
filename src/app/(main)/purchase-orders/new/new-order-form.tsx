"use client";

import { useActionState, useState } from "react";
import { SearchSelect } from "@/components/search-select";
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
  /** 行备注（如包装、交货要求） */
  remark: string;
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
    return { productId: "", unitName: "", quantity: "", unitPrice: "", remark: "" };
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
      {/* 厂家信息（可折叠） */}
      <details open className="rounded-xl border border-gray-200 bg-white">
        <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-gray-900">
          厂家信息
          <span className="ml-2 text-xs font-normal text-gray-400">
            {supplierId
              ? suppliers.find((x) => String(x.id) === supplierId)?.name ?? "已选择"
              : "尚未选择厂家"}
          </span>
        </summary>
        <div className="border-t border-gray-100 p-5">
        <div className="min-w-56">
          <label htmlFor="supplierId" className="block text-xs font-medium text-gray-600">
            供应商 *
          </label>
          <SearchSelect
            key={`po-sup-${supplierId}`}
            name="supplierId"
            options={suppliers.map((s) => ({ value: String(s.id), label: s.name }))}
            defaultValue={supplierId}
            noneLabel="请选择厂家"
            placeholder="厂家（可搜索）"
            className="mt-1"
            onChange={setSupplierId}
          />
        </div>
        </div>
      </details>

      {/* 商品明细与备注（可折叠） */}
      <details open className="rounded-xl border border-gray-200 bg-white">
        <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-gray-900">
          商品明细与备注
          <span className="ml-2 text-xs font-normal text-gray-400">
            {rows.length} 行 ・ 合计 ¥{total.toFixed(2)}
          </span>
        </summary>
        <div className="space-y-4 border-t border-gray-100 p-5">
      {/* 单据备注（作用于整张单据，放在商品明细上方） */}
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="remark" className="shrink-0 text-sm text-gray-600">
          单据备注
        </label>
        <input
          id="remark"
          name="remark"
          type="text"
          maxLength={200}
          placeholder="选填，如交货方式、包装要求（作用于整张单据）"
          className="min-w-64 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        />
      </div>

      {/* 商品清单：每个商品一张卡片，字段按 商品 / 数量单价 / 行备注 分组 */}
      <div className="space-y-3">
        {rows.map((row, i) => (
          <div key={i} className="rounded-xl border border-gray-200 bg-white p-4">
            {/* ① 商品 */}
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  商品 <span className="text-red-500">*</span>
                </label>
                <SearchSelect
                  key={`po-prod-${i}-${row.productId}`}
                  name={`item_${i}_productId`}
                  options={products.map((p) => ({ value: String(p.id), label: p.label }))}
                  defaultValue={row.productId}
                  noneLabel="请选择商品"
                  placeholder="商品（可搜索名称 / 编码）"
                  onChange={(v) => onProductChange(i, v)}
                />
              </div>
              <button
                type="button"
                onClick={() => setRows((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev))}
                className="mt-6 shrink-0 rounded-md border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50"
              >
                删除本行
              </button>
            </div>

            {row.productId ? (
              <>
            {/* ② 数量 / 单位 / 进价 / 金额 */}
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  数量 <span className="text-red-500">*</span>
                </label>
                <input
                  name={`item_${i}_quantity`}
                  type="number"
                  min="0.001"
                  step="0.001"
                  inputMode="decimal"
                  required
                  value={row.quantity}
                  onChange={(e) =>
                    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, quantity: e.target.value } : r)))
                  }
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">单位</label>
                <div className="px-2 py-1.5 text-sm text-gray-700">{row.unitName || "—"}</div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  进价 <span className="text-red-500">*</span>
                </label>
                <input
                  name={`item_${i}_unitPrice`}
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={row.unitPrice}
                  onChange={(e) =>
                    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, unitPrice: e.target.value } : r)))
                  }
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">行金额</label>
                <div className="px-2 py-1.5 text-lg font-semibold tabular-nums text-gray-900">
                  ¥{lineAmount(row).toFixed(2)}
                </div>
              </div>
            </div>

            {/* ③ 行备注 */}
            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-gray-500">行备注</label>
              <input
                name={`item_${i}_remark`}
                type="text"
                maxLength={200}
                placeholder="选填，如包装、交货要求"
                value={row.remark}
                onChange={(e) =>
                  setRows((prev) => prev.map((r, j) => (j === i ? { ...r, remark: e.target.value } : r)))
                }
                className={inputCls}
              />
            </div>
              </>
            ) : (
              <p className="mt-3 text-xs text-gray-400">选择商品后即可填写数量、进价与行备注</p>
            )}
          </div>
        ))}
      </div>

      {/* 清单操作与合计 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
        <button
          type="button"
          onClick={() => setRows((prev) => [...prev, emptyRow()])}
          className="rounded-md border border-blue-300 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50"
        >
          + 添加商品行
        </button>
        <div className="text-sm text-gray-600">
          合计：
          <span className="text-lg font-semibold tabular-nums text-gray-900">¥{total.toFixed(2)}</span>
        </div>
      </div>

        </div>
      </details>

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
