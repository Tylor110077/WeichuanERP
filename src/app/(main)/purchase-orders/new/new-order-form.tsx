"use client";

import { useActionState, useState } from "react";
import { btnPrimary, btnSmallPrimary, inputBase } from "@/lib/ui";
import { SearchSelect } from "@/components/search-select";
import { createPurchaseOrderAction, type FormState } from "../actions";
import { FormStateAlert } from "@/components/form-alert";

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

const inputCls = `w-full ${inputBase}`;

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
        <summary className="cursor-pointer rounded-t-xl px-5 py-3 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50">
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
            厂家 *
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
        <summary className="cursor-pointer rounded-t-xl px-5 py-3 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50">
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
          className={`${inputBase} min-w-64 flex-1`}
        />
      </div>

      {/* 商品清单：每行一个商品，字段标签内联、行间以分隔线区隔 */}
      <div className="divide-y divide-gray-100 border-y border-gray-100">
        {rows.map((row, i) => (
          <div key={i} className="py-4">
            {/* 商品 */}
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <SearchSelect
                  key={`po-prod-${i}-${row.productId}`}
                  name={`item_${i}_productId`}
                  options={products.map((p) => ({ value: String(p.id), label: p.label }))}
                  defaultValue={row.productId}
                  noneLabel="搜索并选择商品"
                  placeholder="商品（可搜索名称 / 编码）"
                  onChange={(v) => onProductChange(i, v)}
                />
              </div>
              <button
                type="button"
                onClick={() => setRows((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev))}
                className="shrink-0 rounded px-1.5 py-1 text-xs text-gray-400 transition hover:bg-red-50 hover:text-red-600"
                title="删除本行"
              >
                删除
              </button>
            </div>

            {row.productId ? (
              <>
                {/* 数量 / 单位 / 进价 / 金额 */}
                <div className="mt-2.5 grid grid-cols-2 gap-x-5 gap-y-2 lg:grid-cols-4">
                  <InlineField label="数量" required>
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
                  </InlineField>
                  <InlineField label="单位">
                    <span className="block py-1.5 text-sm text-gray-700">{row.unitName || "—"}</span>
                  </InlineField>
                  <InlineField label="进价" required>
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
                  </InlineField>
                  <InlineField label="金额">
                    <span className="block py-1.5 text-base font-semibold tabular-nums text-gray-900">
                      ¥{lineAmount(row).toFixed(2)}
                    </span>
                  </InlineField>
                </div>

                {/* 行备注 */}
                <div className="mt-2.5 flex items-center gap-2">
                  <span className="w-16 shrink-0 text-xs text-gray-500">行备注</span>
                  <input
                    name={`item_${i}_remark`}
                    type="text"
                    maxLength={200}
                    placeholder="选填，如包装、交货要求"
                    value={row.remark}
                    onChange={(e) =>
                      setRows((prev) => prev.map((r, j) => (j === i ? { ...r, remark: e.target.value } : r)))
                    }
                    className={`${inputCls} flex-1`}
                  />
                </div>
              </>
            ) : (
              <p className="mt-2 text-xs text-gray-400">选择商品后填写数量、进价与行备注</p>
            )}
          </div>
        ))}
      </div>

      {/* 底部操作与合计（去边框） */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setRows((prev) => [...prev, emptyRow()])}
          className={btnSmallPrimary}
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

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || !supplierId}
          title={!supplierId ? "请先选择厂家" : undefined}
          className={btnPrimary}
        >
          {pending ? "提交中…" : "提交进货单"}
        </button>
        {!supplierId && (
          <span className="text-sm text-amber-600">请先在上方选择厂家，再提交单据</span>
        )}
        <FormStateAlert state={state} />
      </div>
    </form>
  );
}


/** 内联字段：标签在左、内容在右，比"标签独占一行"更紧凑 */
function InlineField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-14 shrink-0 py-1.5 text-xs text-gray-500">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
