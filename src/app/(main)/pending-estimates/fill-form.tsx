"use client";

import { useActionState, useState, useTransition } from "react";
import { btnPrimary, inputBase } from "@/lib/ui";
import { FormStateAlert } from "@/components/form-alert";
import { SearchSelect } from "@/components/search-select";
import { createQuickSupplierAction } from "../suppliers/actions";
import { fillEstimatedAction, type FillState } from "./actions";

/**
 * 补单行的「补厂家与进价」：只放这一行**还没有**的东西——厂家、进价、提交按钮。
 * 品名/分类/参考进价是对商品档案的补正，直接放在表格对应列的单元格里（用 form={formId} 关联到这里），
 * 不再在右侧重复一个编辑框。
 */
export function FillForm({
  formId,
  itemId,
  suppliers,
}: {
  /** 这一行表单的 id：同行的其它单元格靠 form 属性把控件关联进来 */
  formId: string;
  itemId: number;
  suppliers: { id: number; name: string; py?: string }[];
}) {
  const [state, action, pending] = useActionState<FillState, FormData>(fillEstimatedAction, null);
  /** 厂家候选：就地新建后追加，不必刷新整页 */
  const [options, setOptions] = useState(suppliers);
  /** 新建后要选中的厂家 id */
  const [pickedId, setPickedId] = useState("");
  const [quickMsg, setQuickMsg] = useState<{ error?: string; ok?: string } | null>(null);
  const [, startQuickCreate] = useTransition();

  /** 就地新建厂家并直接选上（与开单页「新建单位/厂家」同一套做法） */
  function quickSupplier(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setQuickMsg({ ok: `正在新建厂家「${trimmed}」…` });
    startQuickCreate(async () => {
      const r = await createQuickSupplierAction({ name: trimmed });
      if ("error" in r) {
        setQuickMsg({ error: r.error });
        return;
      }
      setOptions((prev) => (prev.some((s) => s.id === r.id) ? prev : [...prev, { id: r.id, name: r.name, py: r.py }]));
      setPickedId(String(r.id));
      setQuickMsg({ ok: `已新建厂家「${r.name}」并选中` });
    });
  }

  return (
    /* 提示条不能放进上面那一排：flex-nowrap 下它会把整排挤坏 */
    <form id={formId} action={action} className="block">
      <div className="flex w-max flex-nowrap items-center gap-2">
        <input type="hidden" name="itemId" value={itemId} />
        <SearchSelect
          /* 新建厂家后要让它显示成「已选中」：SearchSelect 的 defaultValue 只在挂载时生效，
             所以用 key 强制重挂载（与开单页估价行的单位字段同一做法） */
          key={`supplier-${pickedId}-${options.length}`}
          name="supplierId"
          options={options.map((s) => ({ value: String(s.id), label: s.name, py: s.py }))}
          defaultValue={pickedId}
          noneLabel="选择厂家"
          placeholder="厂家（可搜索 / 可新建）"
          ariaLabel="补货厂家"
          className="w-52"
          createLabel={(k) => `＋ 新建厂家：「${k}」`}
          onCreate={quickSupplier}
        />
        <input
          name="unitPrice"
          type="number"
          min="0.01"
          step="0.01"
          required
          placeholder="进价"
          title="本次实际进价：生成进货单，并把成本写回原售卖单那一行"
          className={`${inputBase} w-24`}
        />
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "处理中…" : "补单"}
        </button>
      </div>
      <FormStateAlert state={quickMsg} compact className="mt-1" />
      <FormStateAlert state={state} compact className="mt-1" />
    </form>
  );
}
