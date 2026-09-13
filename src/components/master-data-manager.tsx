"use client";

import Link from "next/link";
import { badgeOk, btnPrimary, btnSecondary, inputBase } from "@/lib/ui";
import { useActionState, useState, type ReactNode } from "react";
import { FormStateAlert } from "@/components/form-alert";
import { RowAction } from "@/components/row-action";

export interface FieldDef {
  name: string;
  label: string;
  required?: boolean;
  maxLength?: number;
  /** 密码等需要下限长度的字段（如初始密码 ≥8 位） */
  minLength?: number;
  step?: string;
  placeholder?: string;
  /** "select"/"multiselect" 通过 options 提供候选；"searchselect" 为可搜索下拉（选项多时）；缺省为文本 */
  type?: "text" | "number" | "password" | "select" | "multiselect" | "searchselect" | "manufacturer";
  options?: { value: string; label: string }[];
  /** searchselect：值为空时的候选标签（如「未分组」） */
  noneLabel?: string;
  /** 新建时的默认值 */
  defaultValue?: string;
}

export interface RowData {
  id: number;
  status: number;
  /** 表格展示内容（可传字符串或带样式的节点，如厂家标签） */
  cells: Record<string, ReactNode>;
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
  /**
   * 表格高度上限类，如 max-h-[32rem]。不传则表格自然增高（默认，适合已分页的列表）。
   * 传入后表格内部滚动、表头吸顶，适合可能累积到上百条又不分页的主数据
   * （客户组织、客户标签、商品分类、计量单位、厂家）。
   */
  scrollClassName?: string;
  /**
   * 表格最小宽度类。列多又挤在窄容器里时（如商品页左栏 + 商品表），
   * 短内容会被压成竖排（「分类」折两行、名字折三行）——给个最小宽度、允许横向滚动，
   * 比把单项挤变形更好读。默认不加，只有确实需要的表传。
   */
  minWidthClass?: string;
  /**
   * 隐藏"新建"那一块内联表单（编辑时仍会显示）。
   * 列表页右上角已经有「+ 新建 XX」跳独立页了，两处入口重复，按用户要求去掉下面这块。
   */
  hideCreate?: boolean;
}

const fieldCls = `mt-1 w-full ${inputBase}`;

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
  scrollClassName,
  minWidthClass = "min-w-full",
  hideCreate = false,
}: Props) {
  const [editing, setEditing] = useState<RowData | null>(null);
  const [saveState, formAction, savePending] = useActionState<FormState, FormData>(saveAction, null);
  const [toggleState, toggleActionState, togglePending] = useActionState<FormState, FormData>(toggleAction, null);
  const [deleteState, deleteActionState, deletePending] = useActionState<FormState, FormData>(deleteAction ?? (async () => null), null);

  // 组织/标签/分类这类主数据可能上百条：给它一个高度上限并让表头吸顶，
  // 免得条目一多就把页面拉成几千像素；滚动条常显，才看得出下面还有。
  // 已分页的列表（如商品列表）不要传，那种列表本身就有边界，套一层内滚动反而别扭。
  const table = (
    <div>
      {/* 停用/删除的反馈只显示一次：放进行里会让每一行都重复出现同一句「已删除」 */}
      <FormStateAlert state={toggleState ?? deleteState} compact className="mb-2" />
      <div
        className={[
          "rounded-xl border border-gray-200 bg-white",
          scrollClassName ? `scroll-thin ${scrollClassName} overflow-auto` : "overflow-x-auto",
        ].join(" ")}
      >
      <table className={`w-full divide-y divide-gray-200 text-sm ${minWidthClass}`}>
        <thead
          className={[
            "bg-gray-50 text-left text-xs text-gray-500",
            scrollClassName ? "sticky top-0 z-10" : "",
          ].join(" ")}
        >
          <tr>
            {columns.map((c) => (
              <th key={c.key} className="px-4 py-3 font-medium">
                {c.label}
              </th>
            ))}
            <th className="whitespace-nowrap px-4 py-3 font-medium">状态</th>
            {isAdmin && <th className="text-right whitespace-nowrap px-4 py-3 font-medium">操作</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 [&>tr]:transition-colors [&>tr:hover]:bg-gray-100/70">
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
                  <span className={badgeOk}>启用</span>
                ) : (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">停用</span>
                )}
              </td>
              {isAdmin && (
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {hideForm && editBase ? (
                      <Link href={`${editBase}/${row.id}`} className="whitespace-nowrap text-xs text-blue-600 hover:underline">
                        编辑
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditing(row)}
                        className="whitespace-nowrap text-xs text-blue-600 hover:underline"
                      >
                        编辑
                      </button>
                    )}
                    <RowAction
                      action={toggleActionState}
                      hidden={{ id: row.id }}
                      label={row.status === 1 ? "停用" : "启用"}
                      confirmLabel={`确认${row.status === 1 ? "停用" : "启用"}`}
                      disabled={togglePending}
                    />
                    {deleteAction && (
                      <RowAction
                        action={deleteActionState}
                        hidden={{ id: row.id }}
                        label="删除"
                        confirmLabel="确认删除"
                        className="whitespace-nowrap text-xs text-gray-500 hover:underline"
                        disabled={deletePending}
                      />
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );

  if (!isAdmin || hideForm) {
    return table;
  }

  return (
    <div className="space-y-6">
      {/* hideCreate：只在编辑时显示表单；新建走列表页右上角那个按钮 */}
      {(!hideCreate || editing) && (
      <form
        key={editing?.id ?? "new"}
        action={formAction}
        // 右上角「+ 新建 XX」按钮锚到这里：页签自带新建表单时不必再做一个独立页
        id="new-entry"
        className="scroll-mt-4 rounded-xl border border-gray-200 bg-white p-5"
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
            className={btnPrimary}
          >
            {savePending ? "保存中…" : editing ? "保存" : "创建"}
          </button>
          {editing && (
            <button
              type="button"
              onClick={() => setEditing(null)}
              className={btnSecondary}
            >
              取消
            </button>
          )}
          <FormStateAlert state={saveState} compact />
        </div>
      </form>
      )}

      {table}
    </div>
  );
}
