"use client";

import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { badgeMuted, badgeOk, btnPrimary, btnSecondary, btnSmallPrimary, btnSmallSolid } from "@/lib/ui";
import { useActionState, useState, useTransition } from "react";
import { SearchSelect } from "@/components/search-select";
import {
  saveCustomerAction,
  toggleCustomerStatusAction,
  deleteCustomerAction,
  createQuickCustomerGroupAction,
  createQuickCustomerTagAction,
  type FormState,
  type QuickResult,
} from "./actions";
import { FormStateAlert } from "@/components/form-alert";

export interface CustomerRowData {
  id: number;
  status: number;
  name: string;
  contact: string;
  phone: string;
  address: string;
  remark: string;
  groupId: number | null;
  groupName: string;
  tagIds: number[];
  tagNames: string[];
}

const inputCls = "mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900";

export function CustomerManager({
  customers,
  groups,
  tags,
  isAdmin,
  hideForm,
  editBase,
}: {
  customers: CustomerRowData[];
  groups: { id: number; name: string; status: number }[];
  tags: { id: number; name: string; status: number }[];
  isAdmin: boolean;
  /** 独立页模式：不渲染平铺表单；行内"编辑"变为链接 */
  hideForm?: boolean;
  editBase?: string;
}) {
  const [groupOptions, setGroupOptions] = useState(groups);
  const [tagOptions, setTagOptions] = useState(tags);
  const [editing, setEditing] = useState<CustomerRowData | null>(null);
  const [form, setForm] = useState({
    name: "",
    contact: "",
    phone: "",
    address: "",
    remark: "",
    groupId: "",
  });
  const [checkedTags, setCheckedTags] = useState<number[]>([]);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showCreateTag, setShowCreateTag] = useState(false);
  const [quickName, setQuickName] = useState("");
  const [quickMsg, setQuickMsg] = useState<{ error?: string } | null>(null);
  const [quickPending, startQuick] = useTransition();
  const [saveState, saveAction, savePending] = useActionState<FormState, FormData>(saveCustomerAction, null);
  const [toggleState, toggleAction, togglePending] = useActionState<FormState, FormData>(toggleCustomerStatusAction, null);
  const [deleteState, deleteAction, deletePending] = useActionState<FormState, FormData>(deleteCustomerAction, null);

  function startCreate(row: CustomerRowData | null) {
    setEditing(row);
    setForm({
      name: row?.name ?? "",
      contact: row?.contact ?? "",
      phone: row?.phone ?? "",
      address: row?.address ?? "",
      remark: row?.remark ?? "",
      groupId: row?.groupId != null ? String(row.groupId) : "",
    });
    setCheckedTags(row?.tagIds ?? []);
    setQuickMsg(null);
  }

  function createGroup() {
    const name = quickName.trim();
    if (!name) return;
    startQuick(async () => {
      const r: QuickResult = await createQuickCustomerGroupAction({ name });
      if ("error" in r) {
        setQuickMsg({ error: r.error });
        return;
      }
      setGroupOptions((prev) => (prev.some((g) => g.id === r.id) ? prev : [...prev, { id: r.id, name: r.name, status: 1 }]));
      setForm((f) => ({ ...f, groupId: String(r.id) }));
      setQuickName("");
      setShowCreateGroup(false);
      setQuickMsg(null);
    });
  }

  function createTag() {
    const name = quickName.trim();
    if (!name) return;
    startQuick(async () => {
      const r: QuickResult = await createQuickCustomerTagAction({ name });
      if ("error" in r) {
        setQuickMsg({ error: r.error });
        return;
      }
      setTagOptions((prev) => (prev.some((t) => t.id === r.id) ? prev : [...prev, { id: r.id, name: r.name, status: 1 }]));
      setCheckedTags((prev) => (prev.includes(r.id) ? prev : [...prev, r.id]));
      setQuickName("");
      setShowCreateTag(false);
      setQuickMsg(null);
    });
  }

  function toggleTag(tagId: number) {
    setCheckedTags((prev) => (prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId]));
  }

  const table = (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50 text-left text-xs text-gray-500">
          <tr>
            <th className="px-4 py-3 font-medium">名称</th>
            <th className="px-4 py-3 font-medium">联系人</th>
            <th className="px-4 py-3 font-medium">电话</th>
            <th className="px-4 py-3 font-medium">组织</th>
            <th className="px-4 py-3 font-medium">标签</th>
            <th className="px-4 py-3 font-medium">状态</th>
            {isAdmin && <th className="px-4 py-3 font-medium">操作</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 [&>tr]:transition-colors [&>tr:hover]:bg-gray-100/70">
          {customers.length === 0 && (
            <tr>
              <td colSpan={7}>
                <EmptyState
                  title="还没有客户"
                  hint="点右上角「新建客户」添加"
                  action={{ href: "/customers/new", label: "+ 新建客户" }}
                />
              </td>
            </tr>
          )}
          {customers.map((c) => (
            <tr key={c.id}>
              <td className="px-4 py-2.5 text-gray-900">{c.name}</td>
              <td className="px-4 py-2.5 text-gray-600">{c.contact || "—"}</td>
              <td className="px-4 py-2.5 text-gray-600">{c.phone || "—"}</td>
              <td className="px-4 py-2.5">
                {c.groupName ? (
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{c.groupName}</span>
                ) : (
                  <span className="text-gray-400">—</span>
                )}
              </td>
              <td className="px-4 py-2.5">
                <div className="flex flex-wrap gap-1">
                  {c.tagNames.map((t) => (
                    <span key={t} className={badgeMuted}>{t}</span>
                  ))}
                  {c.tagNames.length === 0 && <span className="text-gray-400">—</span>}
                </div>
              </td>
              <td className="px-4 py-2.5">
                {c.status === 1 ? (
                  <span className={badgeOk}>启用</span>
                ) : (
                  <span className={badgeMuted}>停用</span>
                )}
              </td>
              {isAdmin && (
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-2">
                    {hideForm && editBase ? (
                      <Link href={`${editBase}/${c.id}`} className="text-xs text-blue-600 hover:underline">
                        编辑
                      </Link>
                    ) : (
                      <button type="button" onClick={() => startCreate(c)} className="text-xs text-blue-600 hover:underline">
                        编辑
                      </button>
                    )}
                    <form action={toggleAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <button type="submit" disabled={togglePending} className="text-xs text-red-600 hover:underline disabled:opacity-50">
                        {c.status === 1 ? "停用" : "启用"}
                      </button>
                    </form>
                    <form action={deleteAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <button type="submit" disabled={deletePending} className="text-xs text-gray-500 hover:underline disabled:opacity-50">
                        删除
                      </button>
                    </form>
                  </div>
                  <FormStateAlert state={toggleState ?? deleteState} compact className="mt-1" />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  if (!isAdmin || hideForm) {
    return (
      <div className="space-y-4">
        {!isAdmin && <div className="text-xs text-gray-400">客户基础资料（含组织/标签）仅管理员可维护</div>}
        {table}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <form
        key={editing?.id ?? "new"}
        action={saveAction}
        className="rounded-xl border border-gray-200 bg-white p-5"
      >
        <input type="hidden" name="id" value={editing?.id ?? ""} />
        <h2 className="mb-3 text-sm font-semibold text-gray-900">
          {editing ? `编辑客户「${editing.name}」（改组织即移动）` : "新建客户"}
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="block text-xs font-medium text-gray-600">客户名称 *</label>
            <input
              name="name"
              type="text"
              required
              maxLength={100}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600">联系人</label>
            <input name="contact" type="text" maxLength={50} value={form.contact}
              onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600">电话</label>
            <input name="phone" type="text" maxLength={30} value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600">地址</label>
            <input name="address" type="text" maxLength={200} value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600">备注</label>
            <input name="remark" type="text" maxLength={200} value={form.remark}
              onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value }))} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600">所属组织（可搜索）</label>
            <div className="mt-1 flex items-center gap-1">
              <SearchSelect
                key={`grp-${form.groupId}-${groupOptions.length}`}
                name="groupId"
                options={groupOptions.map((g) => ({
                  value: String(g.id),
                  label: g.status === 1 ? g.name : `${g.name}（停用）`,
                }))}
                defaultValue={form.groupId}
                noneLabel="未分组"
                placeholder="输入关键词搜索组织…"
                emptyHint="无匹配组织，可点右侧「+ 组织」新建"
                className="flex-1"
                onChange={(v) => setForm((f) => ({ ...f, groupId: v }))}
              />
              <button
                type="button"
                onClick={() => { setShowCreateGroup((v) => !v); setShowCreateTag(false); setQuickName(""); }}
                className={`shrink-0 ${btnSmallPrimary}`}
              >
                + 组织
              </button>
            </div>
            {showCreateGroup && (
              <div className="mt-1 flex items-center gap-1">
                <input
                  placeholder="新组织名称"
                  maxLength={50}
                  value={quickName}
                  onChange={(e) => setQuickName(e.target.value)}
                  className="w-full rounded-md border border-blue-200 px-2 py-1.5 text-sm text-gray-900"
                />
                <button type="button" onClick={createGroup} disabled={quickPending}
                  className={`shrink-0 ${btnSmallSolid}`}>
                  {quickPending ? "…" : "创建"}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="mt-3">
          <label className="block text-xs font-medium text-gray-600">标签（可多选）</label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {tagOptions.map((t) => (
              <label
                key={t.id}
                className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs cursor-pointer ${
                  checkedTags.includes(t.id)
                    ? "border-blue-300 bg-blue-50 text-blue-700"
                    : "border-gray-200 bg-white text-gray-600"
                }`}
              >
                <input
                  type="checkbox"
                  name="tagIds"
                  value={t.id}
                  checked={checkedTags.includes(t.id)}
                  onChange={() => toggleTag(t.id)}
                  className="sr-only"
                />
                {t.name}
              </label>
            ))}
            <button
              type="button"
              onClick={() => { setShowCreateTag((v) => !v); setShowCreateGroup(false); setQuickName(""); }}
              className="rounded-full border border-dashed border-blue-300 px-2.5 py-1 text-xs text-blue-600 hover:bg-blue-50"
            >
              + 标签
            </button>
            {showCreateTag && (
              <>
                <input
                  placeholder="新标签名称"
                  maxLength={30}
                  value={quickName}
                  onChange={(e) => setQuickName(e.target.value)}
                  className="w-28 rounded-md border border-blue-200 px-2 py-1 text-xs text-gray-900"
                />
                <button type="button" onClick={createTag} disabled={quickPending}
                  className={btnSmallSolid}>
                  {quickPending ? "…" : "创建"}
                </button>
              </>
            )}
          </div>
          <FormStateAlert state={quickMsg} compact className="mt-1" />
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button
            type="submit"
            disabled={savePending}
            className={btnPrimary}
          >
            {savePending ? "保存中…" : editing ? "保存（移动组织/标签随保存生效）" : "创建客户"}
          </button>
          {editing && (
            <button type="button" onClick={() => startCreate(null)}
              className={btnSecondary}>
              取消
            </button>
          )}
          <FormStateAlert state={saveState} />
        </div>
      </form>

      {table}
    </div>
  );
}
