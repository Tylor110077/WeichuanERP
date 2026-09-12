import { redirect } from "next/navigation";
import { badgeMuted, btnPrimary, btnSecondary } from "@/lib/ui";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { MasterDataManager } from "@/components/master-data-manager";
import { AutoFilterForm } from "@/components/auto-filter-form";
import { PageTabs, resolveTab } from "@/components/page-tabs";
import { MasterRail } from "@/components/master-rail";
import { FilterForm } from "@/components/filter-form";
import { EmptyState } from "@/components/empty-state";
import { buildCustomerProfile } from "@/lib/customer-profile";
import { CustomerManager } from "./customer-manager";
import {
  deleteCustomerGroupAction,
  deleteCustomerTagAction,
  saveCustomerGroupAction,
  saveCustomerTagAction,
  toggleCustomerGroupStatusAction,
  toggleCustomerTagStatusAction,
} from "./actions";

export const metadata = { title: "客户管理 - 玮川进销存" };

/** 页签白名单：非法的 ?tab= 回落到「客户」 */
const TAB_KEYS = ["customers", "groups", "profile"] as const;

/** 客户会越来越多：列表按页取，不在首屏全量渲染 */
const PAGE_SIZE = 50;

/** 卡片小标题 + 说明 */
function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ groupId?: string; tagId?: string; q?: string; tab?: string; page?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  // groupId=none 表示"未分组"（左栏最后一项）
  const groupIdRaw = params.groupId;
  const groupId = groupIdRaw && groupIdRaw !== "none" ? Number(groupIdRaw) : undefined;
  const ungrouped = groupIdRaw === "none";
  const tagId = params.tagId ? Number(params.tagId) : undefined;
  const q = params.q?.trim();
  const tab = resolveTab(TAB_KEYS, params.tab, "customers");
  const page = Math.max(1, Number(params.page) || 1);

  // 客户一多就没有别的办法找人了：名称 / 联系人 / 电话都能搜
  const customerWhere = {
    ...(ungrouped ? { groupId: null } : groupId ? { groupId } : {}),
    ...(tagId ? { tagLinks: { some: { tagId } } } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q } },
            { contact: { contains: q } },
            { phone: { contains: q } },
          ],
        }
      : {}),
  };

  const [customers, customerTotal, allCustomerTotal, ungroupedTotal, groups, tags] = await Promise.all([
    prisma.customer.findMany({
      where: customerWhere,
      orderBy: { createdAt: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        group: { select: { id: true, name: true } },
        tagLinks: { include: { tag: { select: { id: true, name: true } } } },
      },
    }),
    prisma.customer.count({ where: customerWhere }),
    // 左栏计数用全量，避免数字随搜索词变化
    prisma.customer.count(),
    prisma.customer.count({ where: { groupId: null } }),
    prisma.customerGroup.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, status: true, _count: { select: { customers: true } } },
    }),
    prisma.customerTag.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, status: true, _count: { select: { links: true } } },
    }),
  ]);

  const { profileRows } = await buildCustomerProfile();

  const customersData = customers.map((c) => ({
    id: c.id,
    status: c.status,
    name: c.name,
    contact: c.contact ?? "",
    phone: c.phone ?? "",
    address: c.address ?? "",
    remark: c.remark ?? "",
    groupId: c.groupId,
    groupName: c.group?.name ?? "",
    tagIds: c.tagLinks.map((l) => l.tag.id),
    tagNames: c.tagLinks.map((l) => l.tag.name),
  }));

  const totalPages = Math.max(1, Math.ceil(customerTotal / PAGE_SIZE));

  /** 分页链接：保留当前筛选与页签 */
  const pageHref = (p: number) => {
    const sp = new URLSearchParams();
    if (tab !== "customers") sp.set("tab", tab);
    if (groupIdRaw) sp.set("groupId", groupIdRaw);
    if (tagId != null) sp.set("tagId", String(tagId));
    if (q) sp.set("q", q);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return `/customers${qs ? `?${qs}` : ""}`;
  };

  /** 左栏（组织）链接：保留右侧列表的关键词与标签，切组织回到第 1 页 */
  const railHref = (key: string) => {
    const sp = new URLSearchParams();
    if (key) sp.set("groupId", key);
    if (tagId != null) sp.set("tagId", String(tagId));
    if (q) sp.set("q", q);
    const qs = sp.toString();
    return `/customers${qs ? `?${qs}` : ""}`;
  };

  /** 页签链接：保留当前筛选（组织/标签/关键词） */
  const tabHref = (key: string) => {
    const sp = new URLSearchParams();
    if (key !== "customers") sp.set("tab", key);
    if (groupId != null) sp.set("groupId", String(groupId));
    if (tagId != null) sp.set("tagId", String(tagId));
    if (q) sp.set("q", q);
    const qs = sp.toString();
    return `/customers${qs ? `?${qs}` : ""}`;
  };
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">客户管理</h1>
        {user.role === "admin" && (
          <Link href="/customers/new" className={btnPrimary}>
            + 新建客户
          </Link>
        )}
      </div>

      <PageTabs
        current={tab}
        tabs={[
          {
            key: "customers",
            label: "客户",
            count: allCustomerTotal,
            href: tabHref("customers"),
            hint: "客户档案：左侧按组织筛选，右侧搜名称/联系人/电话",
          },
          {
            key: "groups",
            label: "组织与标签",
            count: `${groups.length} · ${tags.length}`,
            href: tabHref("groups"),
            hint: "客户组织（可移动归属）与标签（一个客户可挂多个）",
          },
          {
            key: "profile",
            label: "客户画像",
            count: profileRows.length,
            href: tabHref("profile"),
            hint: "按客户统计单数、销售额、毛利与平均利润率",
          },
        ]}
      />

      {/* 主从同屏：左栏组织（可搜索、带客户数）→ 右栏该组织的客户 */}
      {tab === "customers" && (
        <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
          <MasterRail
            title="客户组织"
            allLabel="全部客户"
            allCount={allCustomerTotal}
            allHref={railHref("")}
            allActive={!groupIdRaw}
            items={groups.map((g) => ({
              key: String(g.id),
              label: g.name,
              count: g._count.customers,
              href: railHref(String(g.id)),
              active: groupId === g.id,
            }))}
            unassigned={{
              label: "未分组",
              count: ungroupedTotal,
              href: railHref("none"),
              active: ungrouped,
            }}
            searchPlaceholder="搜索组织…"
            emptyText="无匹配组织"
          />

          <div className="min-w-0 space-y-3">
            {/* 工具栏：关键词 + 标签筛选（组织在左栏） */}
            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4">
              <FilterForm className="flex flex-wrap items-end gap-3">
                <div className="min-w-56 flex-1">
                  <label htmlFor="q" className="block text-xs font-medium text-gray-600">搜索客户</label>
                  <input
                    id="q"
                    type="search"
                    name="q"
                    defaultValue={q ?? ""}
                    placeholder="名称 / 联系人 / 电话"
                    className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>
                {groupIdRaw && <input type="hidden" name="groupId" value={groupIdRaw} />}
                {tagId != null && <input type="hidden" name="tagId" value={tagId} />}
                <button type="submit" className={btnSecondary}>查询</button>
                {q && (
                  <Link
                    href={`/customers?${new URLSearchParams({
                      ...(groupIdRaw ? { groupId: groupIdRaw } : {}),
                      ...(tagId != null ? { tagId: String(tagId) } : {}),
                    }).toString()}`}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    清除关键词
                  </Link>
                )}
              </FilterForm>
              {/* 一个客户可挂多个标签，不适合做左栏主轴，仍用下拉筛选 */}
              <AutoFilterForm
                basePath="/customers"
                fields={[
                  {
                    name: "tagId",
                    label: "标签",
                    current: tagId != null ? String(tagId) : "",
                    options: [
                      { value: "", label: "全部标签" },
                      ...tags.map((t) => ({ value: String(t.id), label: t.name })),
                    ],
                  },
                ]}
              />
            </div>

            {page > totalPages && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
                当前页码超出范围（共 {totalPages} 页），下面没有数据。
                <Link href={pageHref(totalPages)} className="ml-1 text-blue-600 hover:underline">
                  跳到最后一页
                </Link>
              </p>
            )}

            <p className="text-xs text-gray-500">
              共 {customerTotal} 位客户
              {q || groupId != null || ungrouped || tagId != null ? "（已应用筛选）" : ""}
              {totalPages > 1 && `　第 ${page} / ${totalPages} 页`}
            </p>

            <CustomerManager
            emptyTitle={q ? `没有匹配「${q}」的客户` : undefined}
            emptyHint={q ? "换个关键词，或点「清除关键词」看全部" : undefined}
            customers={customersData}
            groups={groups}
            tags={tags}
            isAdmin={user.role === "admin"}
            hideForm
            editBase="/customers"
            />

            {totalPages > 1 && (
              <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm">
                {page > 1 ? (
                  <Link href={pageHref(page - 1)} className="text-blue-600 hover:underline">上一页</Link>
                ) : (
                  <span className="text-gray-400">上一页</span>
                )}
                <span className="text-gray-600">第 {page} / {totalPages} 页</span>
                {page < totalPages ? (
                  <Link href={pageHref(page + 1)} className="text-blue-600 hover:underline">下一页</Link>
                ) : (
                  <span className="text-gray-400">下一页</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

            {tab === "groups" && (
              <div className="grid gap-6 lg:grid-cols-2">
              <section className="rounded-xl border border-gray-200 bg-white p-5">
                <SectionHeading title="客户组织" hint="客户归属组织可移动，未被引用可删除" />
                <MasterDataManager
                  entityLabel="组织"
                  columns={[
                    { key: "name", label: "组织名称" },
                    { key: "customerCount", label: "客户数" },
                  ]}
                  fields={[
                    { name: "name", label: "组织名称", required: true, maxLength: 50 },
                  ]}
                  rows={groups.map((g) => ({
                    id: g.id,
                    status: g.status,
                    cells: { name: g.name, customerCount: `${g._count.customers} 个` },
                    formValues: { name: g.name },
                  }))}
                  isAdmin={user.role === "admin"}
                  saveAction={saveCustomerGroupAction}
                  toggleAction={toggleCustomerGroupStatusAction}
                  deleteAction={deleteCustomerGroupAction}
                />
              </section>
              <section className="rounded-xl border border-gray-200 bg-white p-5">
                <SectionHeading title="客户标签" hint="一个客户可挂多个标签，未被引用可删除" />
                <MasterDataManager
                  entityLabel="标签"
                  columns={[
                    { key: "name", label: "标签名称" },
                    { key: "customerCount", label: "客户数" },
                  ]}
                  fields={[
                    { name: "name", label: "标签名称", required: true, maxLength: 30 },
                  ]}
                  rows={tags.map((t) => ({
                    id: t.id,
                    status: t.status,
                    cells: { name: t.name, customerCount: `${t._count.links} 个` },
                    formValues: { name: t.name },
                  }))}
                  isAdmin={user.role === "admin"}
                  saveAction={saveCustomerTagAction}
                  toggleAction={toggleCustomerTagStatusAction}
                  deleteAction={deleteCustomerTagAction}
                />
              </section>
              </div>
            )}

            {tab === "profile" && (
              <section className="rounded-xl border border-gray-200 bg-white p-5">
                <SectionHeading
                  title="客户画像"
                  hint="按客户统计单数、销售额、成本、毛利与平均利润率；点行内「看明细」进入该客户详情"
                />
                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50 text-left text-xs text-gray-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">客户</th>
                        <th className="px-4 py-3 font-medium">组织</th>
                        <th className="px-4 py-3 font-medium">标签</th>
                        <th className="px-4 py-3 text-right font-medium tabular-nums">成交单数</th>
                        <th className="px-4 py-3 text-right font-medium tabular-nums">销售额</th>
                        <th className="px-4 py-3 text-right font-medium tabular-nums">成本</th>
                        <th className="px-4 py-3 text-right font-medium tabular-nums">毛利</th>
                        <th className="px-4 py-3 text-right font-medium tabular-nums">平均利润率</th>
                        <th className="px-4 py-3 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 [&>tr]:transition-colors [&>tr:hover]:bg-gray-100/70">
                      {profileRows.length === 0 && (
                        <tr>
                          <td colSpan={9}>
                            <EmptyState
                              title="暂无成交客户"
                              hint="开出第一张售卖单后自动统计"
                              action={{ href: "/sale-orders/new", label: "+ 去开售卖单" }}
                            />
                          </td>
                        </tr>
                      )}
                      {profileRows.map((r) => (
                        <tr key={r.id}>
                          <td className="px-4 py-2.5 text-gray-900">{r.name}</td>
                          <td className="px-4 py-2.5">
                            {r.groupName ? (
                              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{r.groupName}</span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex flex-wrap gap-1">
                              {r.tagNames.map((t) => (
                                <span key={t} className={badgeMuted}>{t}</span>
                              ))}
                              {r.tagNames.length === 0 && <span className="text-gray-400">—</span>}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-900 tabular-nums">{r.count}</td>
                          <td className="px-4 py-2.5 text-right text-gray-900 tabular-nums">¥{r.sales.toFixed(2)}</td>
                          <td className="px-4 py-2.5 text-right text-gray-600 tabular-nums">¥{r.cost.toFixed(2)}</td>
                          <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${r.profit >= 0 ? "text-green-700" : "text-red-600"}`}>
                            ¥{r.profit.toFixed(2)}
                          </td>
                          <td className={`px-4 py-2.5 text-right tabular-nums ${r.margin >= 0 ? "text-green-700" : "text-red-600"}`}>
                            {r.margin.toFixed(2)}%
                          </td>
                          <td className="px-4 py-2.5">
                            <Link href={`/customer-profile?customerId=${r.id}`} className="text-blue-600 hover:underline">
                              看明细
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
    </div>
  );
}
