"use client";

import { useActionState } from "react";
import { btnPrimary, inputBase } from "@/lib/ui";
import { FormStateAlert } from "@/components/form-alert";
import { SearchSelect } from "@/components/search-select";
import { fillEstimatedAction, type FillState } from "./actions";

/** 补单表单：一行一个，填厂家与进价（品名可顺手改掉开单时的临时名） */
export function FillForm({
  itemId,
  productName,
  suppliers,
}: {
  itemId: number;
  /** 当前商品名（临时名就改这里） */
  productName: string;
  suppliers: { id: number; name: string; py?: string }[];
}) {
  const [state, action, pending] = useActionState<FillState, FormData>(fillEstimatedAction, null);

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="itemId" value={itemId} />
      <input
        name="productName"
        type="text"
        defaultValue={productName}
        maxLength={100}
        title="开单时用的临时名，可以在这里改成真实品名"
        className={`${inputBase} w-56`}
      />
      <SearchSelect
        name="supplierId"
        options={suppliers.map((s) => ({ value: String(s.id), label: s.name, py: s.py }))}
        noneLabel="选择厂家"
        placeholder="厂家（可搜索）"
        className="w-44"
      />
      <input
        name="unitPrice"
        type="number"
        min="0.01"
        step="0.01"
        required
        placeholder="进价"
        title="问到价格后填这里；成本会写回原售卖单那一行"
        className={`${inputBase} w-28`}
      />
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "处理中…" : "补单"}
      </button>
      <FormStateAlert state={state} compact className="basis-full" />
    </form>
  );
}
