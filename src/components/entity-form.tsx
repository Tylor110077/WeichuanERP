"use client";

import { useState, useTransition, useActionState } from "react";
import type { FieldDef, FormState } from "./master-data-manager";
import { SearchSelect } from "./search-select";
import { btnPrimary, inputBase } from "@/lib/ui";
import { matchesSearch } from "@/lib/pinyin";
import { FormStateAlert } from "@/components/form-alert";

const inputCls = `mt-1 w-full ${inputBase}`;

/**
 * 独立新建/编辑页表单（"跳转页面填写 → 提交后返回列表"模式）。
 * 字段支持 text / number / select / multiselect（如客户标签）。
 * 成功后由调用方的 server action redirect 回列表页。
 */
export function EntityForm({
  fields,
  initial,
  initialId,
  initialTags,
  saveAction,
  submitLabel,
  manufacturerSuppliers,
  onQuickCreateSupplier,
}: {
  fields: FieldDef[];
  initial?: Record<string, string>;
  /** 编辑模式：随表单提交的 id（name="id"） */
  initialId?: number;
  initialTags?: string[];
  saveAction: (prev: FormState, fd: FormData) => Promise<FormState>;
  submitLabel: string;
  /** 厂家字段（type="manufacturer"）：厂家档案自动补全 */
  manufacturerSuppliers?: { id: number; name: string; py?: string }[];
  onQuickCreateSupplier?: (data: { name: string }) => Promise<{ id: number; name: string } | { error: string }>;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(saveAction, null);

  return (
    <form
      action={formAction}
      className="max-w-3xl rounded-xl border border-gray-200 bg-white p-5"
    >
      {initialId != null && <input type="hidden" name="id" value={initialId} />}
      <h2 className="mb-3 text-sm font-semibold text-gray-900">{submitLabel}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map((f) => {
          const value =
            initial?.[f.name] ?? (f.defaultValue ? String(f.defaultValue) : "");
          if (f.type === "manufacturer") {
            return (
              <ManufacturerField
                key={f.name}
                name={f.name}
                label={f.label}
                placeholder={f.placeholder}
                required={f.required}
                initial={value}
                suppliers={manufacturerSuppliers ?? []}
                onQuickCreate={onQuickCreateSupplier}
              />
            );
          }
          if (f.type === "multiselect" && f.options) {
              return (
                <div key={f.name} className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-600">{f.label}</label>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {f.options.map((o) => {
                      const checked = (initialTags ?? []).includes(o.value);
                      return (
                        <label
                          key={o.value}
                          className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs cursor-pointer ${
                            checked
                              ? "border-blue-300 bg-blue-50 text-blue-700"
                              : "border-gray-200 bg-white text-gray-600"
                          }`}
                        >
                          <input
                            type="checkbox"
                            name={f.name}
                            value={o.value}
                            defaultChecked={checked}
                            className="sr-only"
                          />
                          {o.label}
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
          }
          if (f.type === "searchselect" && f.options) {
            return (
              <div key={f.name}>
                <label className="block text-xs font-medium text-gray-600">{f.label}</label>
                <SearchSelect
                  name={f.name}
                  options={f.options}
                  defaultValue={value}
                  noneLabel={f.noneLabel}
                  placeholder={f.placeholder ?? "输入关键词搜索…"}
                  emptyHint="无匹配项（可先到列表页新建）"
                  className="mt-1"
                />
              </div>
            );
          }
          if (f.options && f.options.length > 0) {
            return (
              <div key={f.name}>
                <label className="block text-xs font-medium text-gray-600">{f.label}</label>
                <select
                  name={f.name}
                  required={f.required}
                  defaultValue={value}
                  className={inputCls}
                >
                  {/* 占位项：调用方已经在选项里给了 value="" 的占位（如「请选择角色」）就不再补，
                      否则下拉里会出现两条一模一样的「请选择角色」 */}
                  {!f.options.some((o) => o.value === "") && <option value="">请选择</option>}
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          }
          return (
            <div key={f.name}>
              <label className="block text-xs font-medium text-gray-600">{f.label}</label>
              <input
                name={f.name}
                type={f.type ?? "text"}
                step={f.step}
                required={f.required}
                maxLength={f.maxLength}
                minLength={f.minLength}
                placeholder={f.placeholder}
                defaultValue={value}
                className={inputCls}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className={btnPrimary}
        >
          {pending ? "提交中…" : submitLabel}
        </button>
        <FormStateAlert state={state} />
      </div>
    </form>
  );
}


function ManufacturerField({
  name,
  label,
  placeholder,
  required,
  initial,
  suppliers,
  onQuickCreate,
}: {
  name: string;
  label: string;
  /** 字段说明（原先写在 label 的括号里，现在统一用 placeholder 承载） */
  placeholder?: string;
  required?: boolean;
  initial: string;
  suppliers: { id: number; name: string; py?: string }[];
  onQuickCreate?: (data: { name: string }) => Promise<{ id: number; name: string } | { error: string }>;
}) {
  const [query, setQuery] = useState(initial);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const kw = query.trim();
  // 中文原样 + 拼音首字母都匹配（两个分支以前是重复的同一句，顺手合并）
  const hits = kw
    ? suppliers.filter((s) => matchesSearch(s.name, s.py ?? "", kw)).slice(0, 30)
    : [];

  function choose(s: { id: number; name: string }) {
    setQuery(s.name);
    setOpen(false);
  }

  function quickCreate() {
    const name = query.trim();
    if (!name || !onQuickCreate) return;
    startTransition(async () => {
      const r = await onQuickCreate({ name });
      if ("error" in r) {
        setMsg(r.error);
        return;
      }
      choose(r);
      setMsg(null);
    });
  }

  return (
    <div>
      <label className="block text-xs font-medium text-gray-600">{label}</label>
      <div className="relative mt-1">
        <input
          name={name}
          type="text"
          autoComplete="off"
          required={required}
          maxLength={100}
          placeholder={placeholder ?? "输入厂家名搜索厂家档案…"}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          className={`${inputBase} w-full  text-gray-900`}
        />
        {open && kw && (
          <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
            {hits.length === 0 && (
              <div className="px-3 py-2 text-xs text-gray-400">无匹配厂家</div>
            )}
            {hits.map((s) => (
              <button
                key={s.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(s)}
                className="block w-full px-3 py-2 text-left text-sm text-gray-900 hover:bg-blue-50"
              >
                {s.name}
              </button>
            ))}
            {onQuickCreate && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={quickCreate}
                disabled={pending}
                className="block w-full border-t border-gray-100 px-3 py-2 text-left text-sm text-blue-600 hover:bg-blue-50 disabled:opacity-50"
              >
                ＋ 新建厂家：「{kw}」
              </button>
            )}
          </div>
        )}
      </div>
      {msg && <p className="mt-1 text-xs text-red-600">{msg}</p>}
    </div>
  );
}
