import { redirect } from "next/navigation";
import { btnPrimary, btnSecondary, inputBase, tagInfo, tagPending } from "@/lib/ui";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { initials } from "@/lib/pinyin";
import { pinyinQuery } from "@/lib/pinyin";
import { MasterDataManager } from "@/components/master-data-manager";
import { PageTabs, resolveTab } from "@/components/page-tabs";
import { MasterRail } from "@/components/master-rail";
import { FilterForm } from "@/components/filter-form";
import { SearchInput } from "@/components/search-input";
import { deleteProductAction, saveProductAction, toggleProductStatusAction } from "./actions";
import {
  deleteCategoryAction,
  saveCategoryAction,
  toggleCategoryStatusAction,
} from "../categories/actions";
import { deleteUnitAction, saveUnitAction, toggleUnitStatusAction } from "../units/actions";
import {
  deleteSupplierAction,
  saveSupplierAction,
  toggleSupplierStatusAction,
} from "../suppliers/actions";

export const metadata = { title: "商品与厂家 - 玮川进销存" };

const NO_MFR = "（未填写厂家）";

/** 页签白名单：非法的 ?tab= 值回落到「商品」，避免出现空白页 */
const TAB_KEYS = ["products", "manufacturers", "categories", "units"] as const;

/** 商品与厂家会越来越多：列表按页取，不在首屏全量渲染 */
const PAGE_SIZE = 50;

/** 卡片小标题 + 说明（原先写在折叠区 summary 里，展开为页签后改为卡片头） */
function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

/** 厂家标签（商品名称旁的标注） */
function MfrTag({ name }: { name: string }) {
  const empty = !name || name === NO_MFR;
  return (
    <span
      className={`inline-block shrink-0 ${empty ? tagPending : tagInfo}`}
    >
      {empty ? "未填厂家" : name}
    </span>
  );
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{
    manufacturer?: string;
    /** 分类筛选：分类 id，或 "none" 表示未分类 */
    category?: string;
    tab?: string;
    q?: string;
    page?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const selected = params.manufacturer ?? "";
  const tab = resolveTab(TAB_KEYS, params.tab, "products");
  const q = params.q?.trim();
  const page = Math.max(1, Number(params.page) || 1);
  const categoryRaw = params.category;
  const categoryId = categoryRaw && categoryRaw !== "none" ? Number(categoryRaw) : undefined;
  const uncategorized = categoryRaw === "none";

  const productWhere = {
    // 厂家/分类筛选必须下推到数据库：分页后只过滤当前页会得到错误结果
    ...(selected ? { manufacturer: selected === NO_MFR ? "" : selected } : {}),
    ...(uncategorized ? { categoryId: null } : categoryId ? { categoryId } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q } },
            { code: { contains: q } },
            { manufacturer: { contains: q } },
            // 拼音首字母：q=dxtx 命中「单芯铜线」、q=yddl 命中「远东电缆」
            { searchPinyin: { contains: pinyinQuery(q) } },
          ],
        }
      : {}),
  };

  const [allProducts, productTotal, units, categories, suppliers] = await Promise.all([
    prisma.product.findMany({
      where: productWhere,
      orderBy: { code: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        category: { select: { name: true } },
        unit: { select: { name: true } },
      },
    }),
    prisma.product.count({ where: productWhere }),
    prisma.unit.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, status: true, _count: { select: { products: true } } } }),
    prisma.productCategory.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, status: true, _count: { select: { products: true } } } }),
    prisma.supplier.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, contact: true, phone: true, address: true, remark: true, status: true },
    }),
  ]);

  const unitOptions = units.map((u) => ({
    value: String(u.id),
    label: u.status === 1 ? u.name : `${u.name}（停用）`,
  }));
  const categoryOptions = categories.map((c) => ({
    value: String(c.id),
    label: c.status === 1 ? c.name : `${c.name}（停用）`,
  }));

  // 按厂家统计商品数：必须用 SQL 聚合（列表已分页，数当前页会得到错误的计数）
  const [mfrGroups, allProductTotal] = await Promise.all([
    prisma.product.groupBy({ by: ["manufacturer"], _count: { _all: true } }),
    prisma.product.count(),
  ]);
  // 分类计数同样用 SQL 聚合（列表分页，数当前页会错）
  const catGroups = await prisma.product.groupBy({ by: ["categoryId"], _count: { _all: true } });
  const catCounts = new Map<number, number>();
  let uncategorizedCount = 0;
  for (const g of catGroups) {
    if (g.categoryId == null) uncategorizedCount += g._count._all;
    else catCounts.set(g.categoryId, g._count._all);
  }

  const mfrCounts = new Map<string, number>();
  for (const g of mfrGroups) {
    const key = g.manufacturer.trim() || NO_MFR;
    mfrCounts.set(key, (mfrCounts.get(key) ?? 0) + g._count._all);
  }
  // 标签行包含：厂家档案 + 商品中已使用但未建档的厂家
  const mfrNames = new Set<string>(suppliers.map((s) => s.name));
  for (const m of mfrCounts.keys()) {
    if (m !== NO_MFR) mfrNames.add(m);
  }
  const archivedNames = new Set(suppliers.map((s) => s.name));
  const chips = [...mfrNames].sort((a, b) => a.localeCompare(b, "zh-CN"));

  const totalPages = Math.max(1, Math.ceil(productTotal / PAGE_SIZE));

  /** 统一的链接构造：厂家 / 分类 / 关键词 / 页码 四个条件互相保留 */
  const listHref = (opts: { manufacturer?: string; category?: string; page?: number; clear?: "manufacturer" | "category" | "all" }) => {
    const sp = new URLSearchParams();
    const mfr = opts.clear === "manufacturer" || opts.clear === "all" ? "" : (opts.manufacturer ?? selected);
    const cat =
      opts.clear === "category" || opts.clear === "all"
        ? ""
        : (opts.category ?? categoryRaw ?? "");
    if (mfr) sp.set("manufacturer", mfr);
    if (cat) sp.set("category", cat);
    if (q) sp.set("q", q);
    if (opts.page && opts.page > 1) sp.set("page", String(opts.page));
    const qs = sp.toString();
    return `/products${qs ? `?${qs}` : ""}`;
  };

  const pageHref = (p: number) => listHref({ page: p });
  /** 左栏（厂家）链接 */
  const railHref = (name: string) => listHref({ manufacturer: name, page: 1 });
  /** 左栏（分类）链接 */
  const catHref = (key: string) => listHref({ category: key, page: 1 });

  /** 页签链接：保留当前筛选，切换页签不丢条件 */
  const tabHref = (key: string) => {
    const sp = new URLSearchParams();
    if (key !== "products") sp.set("tab", key);
    if (selected) sp.set("manufacturer", selected);
    if (categoryRaw) sp.set("category", categoryRaw);
    if (q) sp.set("q", q);
    const qs = sp.toString();
    return `/products${qs ? `?${qs}` : ""}`;
  };
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">商品与厂家</h1>
        {user.role === "admin" && (
          <Link href="/products/new" className={btnPrimary}>
            + 新建商品
          </Link>
        )}
      </div>

      <PageTabs
        current={tab}
        tabs={[
          {
            key: "products",
            label: "商品",
            count: allProductTotal,
            href: tabHref("products"),
            hint: "商品档案：左侧按厂家筛选，右侧看该厂家的商品",
          },
          {
            key: "manufacturers",
            label: "厂家管理",
            count: suppliers.length,
            href: tabHref("manufacturers"),
            hint: "厂家档案：缺货开单会按商品上的厂家自动向该厂家补货",
          },
          {
            key: "categories",
            label: "商品分类",
            count: categories.length,
            href: tabHref("categories"),
            hint: "商品分类字典：有商品的分类不可删除，请停用",
          },
          {
            key: "units",
            label: "计量单位",
            count: units.length,
            href: tabHref("units"),
            hint: "计量单位字典：被商品引用的单位不可删除，请停用",
          },
        ]}
      />

      {/* 主从同屏：左栏是筛选轴（厂家 / 商品分类，可搜索、带商品数）→ 右栏商品列表 */}
      {tab === "products" && (
        <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
          <div className="space-y-4">
          <MasterRail
            title="厂家"
            allLabel="全部厂家"
            allCount={allProductTotal}
            allHref={railHref("")}
            allActive={selected === ""}
            items={chips.map((name) => ({
              key: name,
              label: archivedNames.has(name) ? name : `${name}（未建档）`,
              py: initials(name),
              count: mfrCounts.get(name) ?? 0,
              href: railHref(name),
              active: selected === name,
            }))}
            unassigned={
              mfrCounts.has(NO_MFR)
                ? {
                    label: "未填厂家",
                    count: mfrCounts.get(NO_MFR) ?? 0,
                    href: railHref(NO_MFR),
                    active: selected === NO_MFR,
                  }
                : undefined
            }
            searchPlaceholder="搜索厂家…"
            emptyText="无匹配厂家"
          />

          <MasterRail
            title="商品分类"
            allLabel="全部分类"
            allCount={allProductTotal}
            allHref={catHref("")}
            allActive={!categoryRaw}
            items={categories.map((c) => ({
              key: String(c.id),
              label: c.status === 1 ? c.name : `${c.name}（停用）`,
              py: initials(c.name),
              count: catCounts.get(c.id) ?? 0,
              href: catHref(String(c.id)),
              active: categoryId === c.id,
            }))}
            unassigned={
              uncategorizedCount > 0
                ? {
                    label: "未分类",
                    count: uncategorizedCount,
                    href: catHref("none"),
                    active: uncategorized,
                  }
                : undefined
            }
            searchPlaceholder="搜索分类…"
            emptyText="无匹配分类"
          />
          </div>

          <div className="min-w-0 space-y-3">
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <FilterForm className="flex flex-wrap items-end gap-2">
                <div>
                  <label htmlFor="q" className="block text-xs font-medium text-gray-600">搜索商品</label>
                  <SearchInput
                    id="q"
                    type="search"
                    name="q"
                    defaultValue={q ?? ""}
                    placeholder="名称 / 编码 / 厂家"
                    className={`${inputBase} mt-1 w-56`}
                  />
                </div>
                {selected && <input type="hidden" name="manufacturer" value={selected} />}
                <button type="submit" className={btnSecondary}>查询</button>
                {q && (
                  <Link href={listHref({ page: 1 })} className="whitespace-nowrap text-xs text-blue-600 hover:underline">
                    清除关键词
                  </Link>
                )}
              </FilterForm>
              <p className="mt-3 border-t border-gray-100 pt-2.5 text-xs text-gray-400">
                厂家名与「厂家管理」页签里的档案同名时，缺货开单会自动向该厂家补货；带「（未建档）」的厂家建议补齐档案。左侧「厂家 / 商品分类」两个条件可叠加使用。
              </p>
            </div>

            {page > totalPages && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
                当前页码超出范围（共 {totalPages} 页），下面没有数据。
                <Link href={pageHref(totalPages)} className="ml-1 text-blue-600 hover:underline">
                  跳到最后一页
                </Link>
              </p>
            )}

            <div className="space-y-2">
              <div className="flex items-baseline gap-2">
                <h2 className="text-sm font-semibold text-gray-900">
                  {selected ? `${selected} 供应的商品` : "全部商品"}
                  {categoryRaw ? (
                    <span className="ml-1.5 text-xs font-normal text-gray-500">
                      · 分类：{uncategorized ? "未分类" : (categories.find((c) => c.id === categoryId)?.name ?? "—")}
                    </span>
                  ) : null}
                </h2>
                <span className="text-xs text-gray-400">
                  共 {productTotal} 个{totalPages > 1 ? `　第 ${page} / ${totalPages} 页` : ""}
                </span>
                {(selected || categoryRaw) && (
                  <Link href={listHref({ clear: "all" })} className="whitespace-nowrap text-xs text-blue-600 hover:underline">
                    清除筛选
                  </Link>
                )}
              </div>
              <MasterDataManager
                        entityLabel="商品"
                        minWidthClass="min-w-[56rem]"
                        hideForm
                        editBase="/products"
                        columns={[
                          { key: "code", label: "编码" },
                          { key: "name", label: "名称" },
                          { key: "category", label: "分类" },
                          { key: "unit", label: "单位" },
                          { key: "refPurchasePrice", label: "参考进价" },
                          { key: "refSalePrice", label: "参考售价" },
                          { key: "stockQty", label: "库存" },
                          { key: "minStock", label: "预警线" },
                        ]}
                        fields={[
                          { name: "name", label: "商品名称", required: true, maxLength: 100 },
                          { name: "manufacturer", label: "厂家 *", required: true, maxLength: 100, placeholder: "如：远东电缆、正泰电器" },
                          {
                            name: "categoryId",
                            label: "分类",
                            options: categoryOptions,
                          },
                          { name: "unitId", label: "单位", required: true, options: unitOptions },
                          {
                            name: "refPurchasePrice",
                            label: "参考进价",
                            type: "number",
                            step: "0.01",
                            placeholder: "0.00",
                          },
                          {
                            name: "refSalePrice",
                            label: "参考售价",
                            type: "number",
                            step: "0.01",
                            placeholder: "0.00",
                          },
                          {
                            name: "minStock",
                            label: "库存预警线",
                            type: "number",
                            step: "0.001",
                            placeholder: "0",
                          },
                        ]}
                        rows={allProducts.map((p) => ({
                          id: p.id,
                          status: p.status,
                          cells: {
                            code: p.code,
                            name: (
                              <span className="flex flex-wrap items-center gap-1.5">
                                <span>{p.name}</span>
                                <MfrTag name={p.manufacturer.trim()} />
                              </span>
                            ),
                            category: p.category?.name ?? "",
                            unit: p.unit.name,
                            refPurchasePrice: Number(p.refPurchasePrice).toFixed(2),
                            refSalePrice: Number(p.refSalePrice).toFixed(2),
                            stockQty: Number(p.stockQty).toFixed(3),
                            minStock: Number(p.minStock).toFixed(3),
                          },
                          formValues: {
                            name: p.name,
                            manufacturer: p.manufacturer,
                            categoryId: p.categoryId != null ? String(p.categoryId) : "",
                            unitId: String(p.unitId),
                            refPurchasePrice: p.refPurchasePrice.toString(),
                            refSalePrice: p.refSalePrice.toString(),
                            minStock: p.minStock.toString(),
                          },
                        }))}
                        isAdmin={user.role === "admin"}
                        saveAction={saveProductAction}
                        toggleAction={toggleProductStatusAction}
                        deleteAction={deleteProductAction}
                      />
            </div>

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

      {tab === "manufacturers" && (
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <SectionHeading
            title="厂家档案"
            hint="开单缺货时按商品上的厂家自动向该厂家补货；已被商品或单据引用的厂家请停用，不要删除"
          />
          <MasterDataManager
                      entityLabel="厂家"
                      scrollClassName="max-h-[32rem]"
                      columns={[
                        { key: "name", label: "厂家名称" },
                        { key: "productCount", label: "商品数" },
                        { key: "contact", label: "联系人" },
                        { key: "phone", label: "电话" },
                        { key: "address", label: "地址" },
                        { key: "remark", label: "备注" },
                      ]}
                      fields={[
                        { name: "name", label: "厂家名称", required: true, maxLength: 100, placeholder: "如：远东电缆、正泰电器" },
                        { name: "contact", label: "联系人", maxLength: 50 },
                        { name: "phone", label: "电话", maxLength: 30 },
                        { name: "address", label: "地址", maxLength: 200 },
                        { name: "remark", label: "备注", maxLength: 200 },
                      ]}
                      rows={suppliers.map((s) => ({
                        id: s.id,
                        status: s.status,
                        cells: {
                          name: s.name,
                          productCount: `${mfrCounts.get(s.name) ?? 0} 个`,
                          contact: s.contact ?? "",
                          phone: s.phone ?? "",
                          address: s.address ?? "",
                          remark: s.remark ?? "",
                        },
                        formValues: {
                          name: s.name,
                          contact: s.contact ?? "",
                          phone: s.phone ?? "",
                          address: s.address ?? "",
                          remark: s.remark ?? "",
                        },
                      }))}
                      isAdmin={user.role === "admin"}
                      saveAction={saveSupplierAction}
                      toggleAction={toggleSupplierStatusAction}
                      deleteAction={deleteSupplierAction}
                    />
        </section>
      )}

      {tab === "categories" && (
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <SectionHeading title="商品分类" hint="有商品的分类不可删除，请停用" />
            <MasterDataManager
                        entityLabel="分类"
                        scrollClassName="max-h-[32rem]"
                        columns={[
                          { key: "name", label: "分类名称" },
                          { key: "count", label: "商品数" },
                        ]}
                        fields={[
                          { name: "name", label: "分类名称", required: true, maxLength: 50 },
                        ]}
                        rows={categories.map((c) => ({
                          id: c.id,
                          status: c.status,
                          cells: { name: c.name, count: `${c._count.products} 个` },
                          formValues: { name: c.name },
                        }))}
                        isAdmin={user.role === "admin"}
                        saveAction={saveCategoryAction}
                        toggleAction={toggleCategoryStatusAction}
                        deleteAction={deleteCategoryAction}
                      />
          </section>
      )}

      {tab === "units" && (
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <SectionHeading title="计量单位" hint="被商品引用的单位不可删除，请停用" />
            <MasterDataManager
                        entityLabel="单位"
                        scrollClassName="max-h-[32rem]"
                        columns={[
                          { key: "name", label: "单位名称" },
                          { key: "count", label: "商品数" },
                        ]}
                        fields={[
                          { name: "name", label: "单位名称", required: true, maxLength: 20 },
                        ]}
                        rows={units.map((u) => ({
                          id: u.id,
                          status: u.status,
                          cells: { name: u.name, count: `${u._count.products} 个` },
                          formValues: { name: u.name },
                        }))}
                        isAdmin={user.role === "admin"}
                        saveAction={saveUnitAction}
                        toggleAction={toggleUnitStatusAction}
                        deleteAction={deleteUnitAction}
                      />
          </section>
      )}
    </div>
  );
}
