import { redirect } from "next/navigation";
import { btnPrimary, btnSecondary, tagInfo, tagPending } from "@/lib/ui";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { MasterDataManager } from "@/components/master-data-manager";
import { PageTabs, resolveTab } from "@/components/page-tabs";
import { FilterForm } from "@/components/filter-form";
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
const TAB_KEYS = ["products", "manufacturers", "options"] as const;

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

/** 厂家筛选标签（顶部一行） */
function MfrChip({
  label,
  count,
  href,
  active,
}: {
  label: string;
  count: number;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 text-sm ${
        active
          ? "border-blue-300 bg-blue-50 font-medium text-blue-700"
          : "border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-600"
      }`}
    >
      {label}
      <span className={`ml-1 text-xs ${active ? "text-blue-500" : "text-gray-400"}`}>{count}</span>
    </Link>
  );
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ manufacturer?: string; tab?: string; q?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const selected = params.manufacturer ?? "";
  const tab = resolveTab(TAB_KEYS, params.tab, "products");
  const q = params.q?.trim();

  const [allProducts, units, categories, suppliers] = await Promise.all([
    prisma.product.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q } },
              { code: { contains: q } },
              { manufacturer: { contains: q } },
            ],
          }
        : {},
      orderBy: { code: "asc" },
      include: {
        category: { select: { name: true } },
        unit: { select: { name: true } },
      },
    }),
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

  // 按厂家归集商品：厂家名 = 商品的 manufacturer（与厂家档案同名即为该厂家的补货来源）
  const mfrOf = (p: (typeof allProducts)[number]) => p.manufacturer.trim() || NO_MFR;
  const mfrCounts = new Map<string, number>();
  for (const p of allProducts) {
    const m = mfrOf(p);
    mfrCounts.set(m, (mfrCounts.get(m) ?? 0) + 1);
  }
  // 标签行包含：厂家档案 + 商品中已使用但未建档的厂家
  const mfrNames = new Set<string>(suppliers.map((s) => s.name));
  for (const m of mfrCounts.keys()) {
    if (m !== NO_MFR) mfrNames.add(m);
  }
  const archivedNames = new Set(suppliers.map((s) => s.name));
  const chips = [...mfrNames].sort((a, b) => a.localeCompare(b, "zh-CN"));

  const products = selected ? allProducts.filter((p) => mfrOf(p) === selected) : allProducts;

  /** 页签链接：保留当前筛选，切换页签不丢条件 */
  const tabHref = (key: string) => {
    const sp = new URLSearchParams();
    if (key !== "products") sp.set("tab", key);
    if (selected) sp.set("manufacturer", selected);
    if (q) sp.set("q", q);
    const qs = sp.toString();
    return `/products${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">商品与厂家</h1>
        {user.role === "admin" && (
          <Link
            href="/products/new"
            className={btnPrimary}
          >
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
            count: allProducts.length,
            href: tabHref("products"),
            hint: "商品档案：按厂家筛选、看库存与参考价、编辑或停用",
          },
          {
            key: "manufacturers",
            label: "厂家",
            count: suppliers.length,
            href: tabHref("manufacturers"),
            hint: "厂家档案：缺货开单会按商品上的厂家自动向该厂家补货",
          },
          {
            key: "options",
            label: "分类与单位",
            count: `${categories.length} · ${units.length}`,
            href: tabHref("options"),
            hint: "商品分类与计量单位字典",
          },
        ]}
      />

      {/* 商品页签：工具栏（搜索 + 厂家筛选）与商品列表 */}
      {tab === "products" && (
      <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <FilterForm className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="q" className="block text-xs font-medium text-gray-600">搜索商品</label>
            <input
              id="q"
              type="search"
              name="q"
              defaultValue={q ?? ""}
              placeholder="名称 / 编码 / 厂家"
              className="mt-1 w-56 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          {selected && <input type="hidden" name="manufacturer" value={selected} />}
          <button type="submit" className={btnSecondary}>查询</button>
          {q && (
            <Link
              href={`/products${selected ? `?manufacturer=${encodeURIComponent(selected)}` : ""}`}
              className="text-xs text-blue-600 hover:underline"
            >
              清除关键词
            </Link>
          )}
        </FilterForm>
        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
          <span className="text-sm font-medium text-gray-700">厂家</span>
          <MfrChip label="全部" count={allProducts.length} href={tabHref("products")} active={selected === ""} />
          {chips.map((name) => (
            <MfrChip
              key={name}
              label={archivedNames.has(name) ? name : `${name}（未建档）`}
              count={mfrCounts.get(name) ?? 0}
              href={`/products?manufacturer=${encodeURIComponent(name)}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              active={selected === name}
            />
          ))}
          {mfrCounts.has(NO_MFR) && (
            <MfrChip
              label="未填厂家"
              count={mfrCounts.get(NO_MFR) ?? 0}
              href={`/products?manufacturer=${encodeURIComponent(NO_MFR)}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              active={selected === NO_MFR}
            />
          )}
        </div>
        <p className="text-xs text-gray-400">
          厂家名与「厂家」页签里的档案同名时，缺货开单会自动向该厂家补货；带「（未建档）」的厂家建议补齐档案。
        </p>
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

      {tab === "options" && (
        <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <SectionHeading title="商品分类" hint="有商品的分类不可删除，请停用" />
          <MasterDataManager
            entityLabel="分类"
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

        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <SectionHeading title="计量单位" hint="被商品引用的单位不可删除，请停用" />
          <MasterDataManager
            entityLabel="单位"
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
        </div>
      )}

      {tab === "products" && (
      <div className="space-y-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold text-gray-900">
            {selected ? `${selected} 供应的商品` : "全部商品"}
          </h2>
          <span className="text-xs text-gray-400">{products.length} 个</span>
          {selected && (
            <Link
              href={`/products${q ? `?q=${encodeURIComponent(q)}` : ""}`}
              className="text-xs text-blue-600 hover:underline"
            >
              清除厂家筛选
            </Link>
          )}
        </div>
        <MasterDataManager
          entityLabel="商品"
          hideForm
          editBase="/products"
          columns={[
            { key: "code", label: "编码" },
            { key: "name", label: "名称" },
            { key: "spec", label: "规格" },
            { key: "category", label: "分类" },
            { key: "unit", label: "单位" },
            { key: "refPurchasePrice", label: "参考进价" },
            { key: "refSalePrice", label: "参考售价" },
            { key: "stockQty", label: "库存" },
            { key: "minStock", label: "预警线" },
          ]}
          fields={[
            { name: "name", label: "商品名称", required: true, maxLength: 100 },
            { name: "spec", label: "规格/型号", maxLength: 100 },
            { name: "manufacturer", label: "厂家 *（缺货时自动向其补货）", required: true, maxLength: 100, placeholder: "如：远东电缆、正泰电器" },
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
          rows={products.map((p) => ({
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
              spec: p.spec ?? "",
              category: p.category?.name ?? "",
              unit: p.unit.name,
              refPurchasePrice: Number(p.refPurchasePrice).toFixed(2),
              refSalePrice: Number(p.refSalePrice).toFixed(2),
              stockQty: Number(p.stockQty).toFixed(3),
              minStock: Number(p.minStock).toFixed(3),
            },
            formValues: {
              name: p.name,
              spec: p.spec ?? "",
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
      )}
    </div>
  );
}
