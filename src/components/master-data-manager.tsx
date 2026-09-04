"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

export interface FieldDef {
  name: string;
  label: string;
  required?: boolean;
  maxLength?: number;
  step?: string;
  placeholder?: string;
  /** "select"/"multiselect" 通过 options 提供候选；缺省为文本 */
  type?: "text" | "number" | "select" | "multiselect" | "manufacturer";
  options?: { value: string; label: string }[];
  /** 新建时的默认值 */
  defaultValue?: string;
}

export interface RowData {
  id: number;
  status: number;
  /** 表格展示文本 */
  cells: Record<string, string>;
  /** 编辑表单预填值（与字段 name 对应） */
  formValues: Record<string, string>;
}

export type FormState = { error?: string; ok?: string } | null;
type ActionFn = (prev: FormState, fd: FormData) => Promise<FormState>;

interface Props {
  entityLabel: string;
  columns: { key: string; label: string }[];
  fields: FieldDef[];
  rows: RowData[];
  isAdmin: boolean;
  saveAction: ActionFn;
  toggleAction: ActionFn;
  deleteAction?: ActionFn;
  /** 独立页模式：不渲染平铺表单；行内"编辑"变为链接（editBase + /{id}） */
  hideForm?: boolean;
  editBase?: string;
}

const fieldCls =
  "mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm";

export function MasterDataManager({
  entityLabel,
  columns,
  fields,
  rows,
  isAdmin,
  saveAction,
  toggleAction,
  deleteAction,
  hideForm,
  editBase,
}: Props) {
  const [editing, setEditing] = useState<RowData | null>(null);
  const [saveState, formAction, savePending] = useActionState<FormState, FormData>(saveAction, null);
  const [toggleState, toggleActionState, togglePending] = useActionState<FormState, FormData>(toggleAction, null);
  const [deleteState, deleteActionState, deletePending] = useActionState<FormState, FormData>(deleteAction ?? (async () => null), null);

  const table = (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50 text-left text-xs text-gray-500">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className="px-4 py-3 font-medium">
                {c.label}
              </th>
            ))}
            <th className="px-4 py-3 font-medium">状态</th>
            {isAdmin && <th className="px-4 py-3 font-medium">操作</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length + (isAdmin ? 2 : 1)} className="px-4 py-8 text-center text-gray-400">
                暂无数据
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((c) => (
                <td key={c.key} className="px-4 py-2.5 text-gray-900">
                  {row.cells[c.key] ?? "—"}
                </td>
              ))}
              <td className="px-4 py-2.5">
                {row.status === 1 ? (
                  <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">启用</span>
                ) : (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">停用</span>
                )}
              </td>
              {isAdmin && (
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-2">
                    {hideForm && editBase ? (
                      <Link href={`${editBase}/${row.id}`} className="text-xs text-blue-600 hover:underline">
                        编辑
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditing(row)}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        编辑
                      </button>
                    )}
                    <form action={toggleActionState}>
                      <input type="hidden" name="id" value={row.id} />
                      <button
                        type="submit"
                        disabled={togglePending}
                        className="text-xs text-red-600 hover:underline disabled:opacity-50"
                      >
                        {row.status === 1 ? "停用" : "启用"}
                      </button>
                    </form>
                    {deleteAction && (
                      <form action={deleteActionState}>
                        <input type="hidden" name="id" value={row.id} />
                        <button
                          type="submit"
                          disabled={deletePending}
                          className="text-xs text-gray-500 hover:underline disabled:opacity-50"
                        >
                          删除
                        </button>
                      </form>
                    )}
                  </div>
                  {toggleState?.error && <p className="text-xs text-red-600">{toggleState.error}</p>}
                  {toggleState?.ok && <p className="text-xs text-green-600">{toggleState.ok}</p>}
                  {deleteState?.error && <p className="text-xs text-red-600">{deleteState.error}</p>}
                  {deleteState?.ok && <p className="text-xs text-green-600">{deleteState.ok}</p>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  if (!isAdmin || hideForm) {
    return table;
  }

  return (
    <div className="space-y-6">
      <form
        key={editing?.id ?? "new"}
        action={formAction}
        className="rounded-xl border border-gray-200 bg-white p-5"
      >
        <input type="hidden" name="id" value={editing?.id ?? ""} />
        <h2 className="mb-3 text-sm font-semibold text-gray-900">
          {editing ? `编辑${entityLabel}` : `新建${entityLabel}`}
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map((f) => (
            <div key={f.name}>
              <label
                htmlFor={`fld-${f.name}`}
                className="block text-xs font-medium text-gray-600"
              >
                {f.label}
              </label>
              {f.options ? (
                <select
                  id={`fld-${f.name}`}
                  name={f.name}
                  required={f.required}
                  defaultValue={editing?.formValues[f.name] ?? f.defaultValue ?? ""}
                  className={fieldCls}
                >
                  <option value="">请选择</option>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={`fld-${f.name}`}
                  name={f.name}
                  type={f.type ?? "text"}
                  step={f.step}
                  required={f.required}
                  maxLength={f.maxLength}
                  placeholder={f.placeholder}
                  defaultValue={editing?.formValues[f.name] ?? f.defaultValue ?? ""}
                  className={fieldCls}
                />
              )}
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="submit"
            disabled={savePending}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {savePending ? "保存中…" : editing ? "保存" : "创建"}
          </button>
          {editing && (
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              取消
            </button>
          )}
          {saveState?.error && <p className="text-xs text-red-600">{saveState.error}</p>}
          {saveState?.ok && <p className="text-xs text-green-600">{saveState.ok}</p>}
        </div>
      </form>

      {table}
    </div>
  );
}
