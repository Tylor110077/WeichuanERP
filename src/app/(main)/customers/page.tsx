import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { MasterDataManager } from "@/components/master-data-manager";
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

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ groupId?: string; tagId?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const groupId = params.groupId ? Number(params.groupId) : undefined;
  const tagId = params.tagId ? Number(params.tagId) : undefined;

  const [customers, groups, tags] = await Promise.all([
    prisma.customer.findMany({
      where: {
        ...(groupId ? { groupId } : {}),
        ...(tagId ? { tagLinks: { some: { tagId } } } : {}),
      },
      orderBy: { createdAt: "asc" },
      include: {
        group: { select: { id: true, name: true } },
        tagLinks: { include: { tag: { select: { id: true, name: true } } } },
      },
    }),
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">客户管理</h1>
        <form className="flex items-center gap-2">
          <select name="groupId" defaultValue={groupId ?? ""} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
            <option value="">全部组织</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          <select name="tagId" defaultValue={tagId ?? ""} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
            <option value="">全部标签</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <button type="submit" className="rounded-md bg-gray-100 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200">
            筛选
          </button>
        </form>
      </div>

      <details className="rounded-xl border border-gray-200 bg-white">
        <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-gray-900">
          客户组织管理（{groups.length} 个）
          <span className="ml-2 text-xs font-normal text-gray-400">点击展开/收起 · 客户归属组织可移动，未被引用可删除</span>
        </summary>
        <div className="border-t border-gray-100 p-5">
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
        </div>
      </details>

      <details className="rounded-xl border border-gray-200 bg-white">
        <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-gray-900">
          客户标签管理（{tags.length} 个）
          <span className="ml-2 text-xs font-normal text-gray-400">点击展开/收起 · 一个客户可挂多个标签，未被引用可删除</span>
        </summary>
        <div className="border-t border-gray-100 p-5">
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
        </div>
      </details>

      <details className="rounded-xl border border-gray-200 bg-white">
        <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-gray-900">
          客户画像（{profileRows.length} 个客户有成交）
          <span className="ml-2 text-xs font-normal text-gray-400">点击展开/收起 · 单数/销售额/毛利/平均利润率，点击客户「看明细」进入详情</span>
        </summary>
        <div className="border-t border-gray-100 p-5">
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium">客户</th>
                  <th className="px-4 py-3 font-medium">组织</th>
                  <th className="px-4 py-3 font-medium">标签</th>
                  <th className="px-4 py-3 text-right font-medium">成交单数</th>
                  <th className="px-4 py-3 text-right font-medium">销售额</th>
                  <th className="px-4 py-3 text-right font-medium">成本</th>
                  <th className="px-4 py-3 text-right font-medium">毛利</th>
                  <th className="px-4 py-3 text-right font-medium">平均利润率</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {profileRows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-gray-400">暂无成交客户（开售卖单后自动统计）</td>
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
                          <span key={t} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{t}</span>
                        ))}
                        {r.tagNames.length === 0 && <span className="text-gray-400">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-900">{r.count}</td>
                    <td className="px-4 py-2.5 text-right text-gray-900">¥{r.sales.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600">¥{r.cost.toFixed(2)}</td>
                    <td className={`px-4 py-2.5 text-right font-medium ${r.profit >= 0 ? "text-green-700" : "text-red-600"}`}>
                      ¥{r.profit.toFixed(2)}
                    </td>
                    <td className={`px-4 py-2.5 text-right ${r.margin >= 0 ? "text-green-700" : "text-red-600"}`}>
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
        </div>
      </details>

      <CustomerManager
        customers={customersData}
        groups={groups}
        tags={tags}
        isAdmin={user.role === "admin"}
      />
    </div>
  );
}
