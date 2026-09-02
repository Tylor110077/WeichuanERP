"use client";

import { useActionState } from "react";
import type { FieldDef, FormState } from "./master-data-manager";

const inputCls = "mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900";

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
}: {
  fields: FieldDef[];
  initial?: Record<string, string>;
  /** 编辑模式：随表单提交的 id（name="id"） */
  initialId?: number;
  initialTags?: string[];
  saveAction: (prev: FormState, fd: FormData) => Promise<FormState>;
  submitLabel: string;
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
                  <option value="">{f.options[0]?.label ?? "请选择"}</option>
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
          className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? "提交中…" : submitLabel}
        </button>
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      </div>
    </form>
  );
}
