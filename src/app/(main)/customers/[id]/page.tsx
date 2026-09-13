import { redirect, notFound } from "next/navigation";
import { NoPermission } from "@/components/empty-state";
import Link from "next/link";
import { badgeMuted, btnSecondary, inputBase } from "@/lib/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { initials } from "@/lib/pinyin";
import { EntityForm } from "@/components/entity-form";
import { DateShortcuts } from "@/components/date-shortcuts";
import { FilterForm } from "@/components/filter-form";
import { buildCustomerProfile } from "@/lib/customer-profile";
import { saveCustomerAction } from "../actions";

export const metadata = { title: "客户详情 - 玮川进销存" };

/**
 * 客户详情页（原来的「编辑客户」与「客户画像」合并成一页）。
 *
 * 为什么合并：同一个客户原来要跑两个页面——一个改资料、一个看画像。
 * 现在一页看全：经营画像（成交单数/销售额/成本/毛利/利润率 + 每张单的商品明细）+ 资料编辑。
 * 权限：管理员/老板都能看画像；只有管理员能改资料（业务员看不到画像，与原来一致）。
 */
export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string; q?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "sales") {
    return <NoPermission text="无权限查看客户详情（管理员/老板）" />;
  }
  const isAdmin = user.role === "admin";

  const { id: idRaw } = await params;
  const id = Number(idRaw);
  const query = await searchParams;

  const customer = Number.isInteger(id)
    ? await prisma.customer.findUnique({ where: { id }, include: { tagLinks: true } })
    : null;
  if (!customer) notFound();

  const [groups, tags, profile] = await Promise.all([
    prisma.customerGroup.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, status: true } }),
    prisma.customerTag.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, status: true } }),
    buildCustomerProfile(query.from, query.to, query.q),
  ]);

  const row = profile.profileRows.find((r) => r.id === id);
  const orders = profile.orders
    .filter((o) => o.customerId === id)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const periodLabel = query.from || query.to ? `${query.from || "最早"} ~ ${query.to || "今天"}` : "全部时间";
  /** 按品名 / 编码搜单的关键词（命中即整单带出，行里高亮命中的那几行） */
  const keyword = query.q?.trim() ?? "";
  const hitProduct = (code: string, name: string) =>
    !!keyword && (name.toLowerCase().includes(keyword.toLowerCase()) || code.toLowerCase().includes(keyword.toLowerCase()));

  const stats: { label: string; value: string; loss?: boolean }[] = [
    { label: "成交单数", value: `${row?.count ?? 0} 张` },
    { label: "销售额", value: `¥${(row?.sales ?? 0).toFixed(2)}` },
    { label: "成本（成本快照）", value: `¥${(row?.cost ?? 0).toFixed(2)}` },
    { label: "毛利", value: `¥${(row?.profit ?? 0).toFixed(2)}`, loss: (row?.profit ?? 0) < 0 },
    { label: "平均利润率", value: `${(row?.margin ?? 0).toFixed(2)}%` },
  ];
  const tagNames = profile.customers.find((c) => c.id === id)?.tagNames ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">
          客户详情
          <span className="ml-3 text-sm font-normal text-gray-600">{customer.name}</span>
          {tagNames.map((t) => (
            <span key={t} className={`ml-2 align-middle ${badgeMuted}`}>
              {t}
            </span>
          ))}
        </h1>
        <Link href="/customers" className={btnSecondary}>
          ← 返回客户列表
        </Link>
      </div>

      {/* 经营画像：与销售分析、应收应付同口径（非作废售卖单 + 单据成本快照） */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex flex-wrap items-baseline gap-2 text-sm font-semibold text-gray-900">
            经营画像
            <span className="text-xs font-normal text-gray-400">
              {periodLabel}
              {keyword && `・品名/编码含「${keyword}」`}
            </span>
          </h2>
          <DateShortcuts basePath={`/customers/${id}`} extraQuery={{ q: keyword }} />
        </div>

        {/* 自定义时间段 + 按品名/编码搜单：与销售分析同一套用法（改日期即筛、文本回车即筛） */}
        <FilterForm className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-gray-50/70 p-3">
          <div>
            <label htmlFor="from" className="block text-xs font-medium text-gray-600">
              开始
            </label>
            <input id="from" type="date" name="from" defaultValue={query.from ?? ""} className={`${inputBase} mt-1`} />
          </div>
          <div>
            <label htmlFor="to" className="block text-xs font-medium text-gray-600">
              结束
            </label>
            <input id="to" type="date" name="to" defaultValue={query.to ?? ""} className={`${inputBase} mt-1`} />
          </div>
          <div className="min-w-52 flex-1">
            <label htmlFor="q" className="block text-xs font-medium text-gray-600">
              品名 / 编码
            </label>
            <input
              id="q"
              name="q"
              type="text"
              defaultValue={keyword}
              placeholder="如 YJV、P000001（回车即筛）"
              className={`${inputBase} mt-1`}
            />
          </div>
          <button type="submit" className={btnSecondary}>
            查询
          </button>
          <Link href={`/customers/${id}`} className="pb-2 text-xs text-gray-500 hover:underline">
            清除筛选
          </Link>
          <span className="pb-2 text-xs text-gray-500">
            命中 {orders.length} 张单
            {keyword && "（含「" + keyword + "」的那几行在下面高亮）"}
          </span>
        </FilterForm>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg border border-gray-100 p-3">
              <div className="text-xs text-gray-500">{s.label}</div>
              <div className={`mt-1 text-lg font-semibold tabular-nums ${s.loss ? "text-red-600" : "text-gray-900"}`}>
                {s.value}
              </div>
            </div>
          ))}
        </div>

        <h3 className="mt-4 mb-2 text-xs font-medium text-gray-500">
          单据明细（{orders.length} 张）
        </h3>
        {orders.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-200 px-3 py-6 text-center text-xs text-gray-400">
            {keyword ? `这段时间没有含「${keyword}」的已开单售卖单` : "该期间没有已开单的售卖单"}
          </p>
        ) : (
          <div className="scroll-thin max-h-[28rem] space-y-2 overflow-y-auto">
            {orders.map((o) => {
              const cost = o.items.reduce((s, it) => s + Number(it.costAmount), 0);
              const profit = Number(o.totalAmount) - cost;
              return (
                <div key={o.id} className="rounded-lg border border-gray-100">
                  <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-3 py-2 text-sm">
                    <Link href={`/sale-orders/${o.id}`} className="whitespace-nowrap text-blue-600 hover:underline">
                      {o.orderNo}
                    </Link>
                    <span className="text-xs text-gray-500">{o.createdAt.toLocaleString("zh-CN")}</span>
                    <span className="ml-auto tabular-nums text-gray-900">¥{Number(o.totalAmount).toFixed(2)}</span>
                    <span className={`w-28 text-xs tabular-nums ${profit >= 0 ? "text-green-700" : "text-red-600"}`}>
                      毛利 ¥{profit.toFixed(2)}
                    </span>
                  </div>
                  <table className="w-full table-fixed text-xs">
                    <thead className="text-left text-gray-500">
                      <tr>
                        <th className="w-[7.5rem] px-3 py-1.5 font-medium">编码</th>
                        <th className="w-[26%] px-3 py-1.5 font-medium">品名</th>
                        <th className="w-[4rem] px-3 py-1.5 font-medium">单位</th>
                        <th className="w-[7.5rem] px-3 py-1.5 font-medium">数量</th>
                        <th className="w-[7.5rem] px-3 py-1.5 font-medium">单价</th>
                        <th className="w-[8.5rem] px-3 py-1.5 font-medium">金额</th>
                        <th className="px-3 py-1.5 font-medium">备注</th>
                      </tr>
                    </thead>
                    <tbody className="text-gray-800">
                      {o.items.map((it) => {
                        const hit = hitProduct(it.product.code, it.product.name);
                        return (
                          <tr key={it.id} className={`border-t border-gray-50 ${hit ? "bg-amber-50" : ""}`}>
                            <td className="px-3 py-1.5 text-gray-600">{it.product.code}</td>
                            <td className="truncate px-3 py-1.5">{it.product.name}</td>
                            <td className="px-3 py-1.5 text-gray-600">{it.unit.name}</td>
                            <td className="px-3 py-1.5 tabular-nums">{Number(it.quantity).toFixed(3)}</td>
                            <td className="px-3 py-1.5 tabular-nums">¥{Number(it.unitPrice).toFixed(2)}</td>
                            <td className="px-3 py-1.5 tabular-nums">¥{Number(it.amount).toFixed(2)}</td>
                            <td className="truncate px-3 py-1.5 text-gray-500">{it.remark || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {isAdmin ? (
        <EntityForm
          fields={[
            { name: "name", label: "客户名称 *", required: true, maxLength: 100 },
            { name: "phone", label: "电话", maxLength: 30 },
            { name: "address", label: "地址", maxLength: 200 },
            { name: "remark", label: "备注", maxLength: 200 },
            {
              name: "groupId",
              label: "所属组织",
              type: "searchselect",
              noneLabel: "未分组",
              placeholder: "改组织即移动，输入关键词搜索",
              options: groups.map((g) => ({
                value: String(g.id),
                label: g.status === 1 ? g.name : `${g.name}（停用）`,
                py: initials(g.name),
              })),
            },
            {
              name: "tagIds",
              label: "标签",
              type: "multiselect",
              options: tags.map((t) => ({
                value: String(t.id),
                label: t.status === 1 ? t.name : `${t.name}（停用）`,
                py: initials(t.name),
              })),
            },
          ]}
          initial={{
            name: customer.name,
            phone: customer.phone ?? "",
            address: customer.address ?? "",
            remark: customer.remark ?? "",
            groupId: customer.groupId != null ? String(customer.groupId) : "",
          }}
          initialId={customer.id}
          initialTags={customer.tagLinks.map((l) => String(l.tagId))}
          saveAction={saveCustomerAction}
          submitLabel="保存资料"
        />
      ) : (
        <p className="text-xs text-gray-400">资料修改需要管理员权限，请联系管理员。</p>
      )}
    </div>
  );
}
