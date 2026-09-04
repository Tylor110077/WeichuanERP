"use client";

import { useActionState, useState, useTransition } from "react";
import { createSaleOrderAction, type FormState } from "../actions";
import {
  createQuickCustomerAction,
  createQuickCustomerGroupAction,
  createQuickCustomerTagAction,
  type QuickCustomerResult,
  type QuickResult,
} from "../../customers/actions";
import { createQuickProductAction, type QuickProductResult } from "../../products/actions";
import { createQuickCategoryAction, type QuickCategoryResult } from "../../categories/actions";
import { createQuickUnitAction, type QuickUnitResult } from "../../units/actions";
import { createQuickSupplierAction } from "../../suppliers/actions";

interface CustomerOption {
  id: number;
  name: string;
  groupName: string;
  tagNames: string[];
}
interface UnitOption {
  id: number;
  name: string;
}
interface CategoryOption {
  id: number;
  name: string;
}
interface SupplierOption {
  id: number;
  name: string;
}
interface ProductOption {
  id: number;
  label: string;
  code: string;
  name: string;
  spec: string;
  manufacturer: string;
  unitName: string;
  stockQty: number;
  refSalePrice: number;
  lastSupplierId: number | null;
  lastSupplyPrice: number;
}

interface Row {
  productId: string;
  productLabel: string; // 选中商品的回填文本（编码 + 名称）
  productCode: string; // 编码输入框（分开显示/搜索）
  productQuery: string; // 名称输入框（搜索用）
  manufacturer: string; // 选中商品的厂商（用于"自动补货：厂商"提示）
  unitName: string;
  stockQty: number;
  quantity: string;
  unitPrice: string;
  supplierId: string;
  supplyPrice: string;
  hasLastSupplier: boolean;
}

const inputCls = "w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm";

export function NewSaleForm({
  customers,
  suppliers,
  products,
  units,
  categories,
  customerGroups,
  customerTags,
  canCreateCustomer,
  canCreateProduct,
}: {
  customers: CustomerOption[];
  suppliers: SupplierOption[];
  products: ProductOption[];
  units: UnitOption[];
  categories: CategoryOption[];
  customerGroups: { id: number; name: string }[];
  customerTags: { id: number; name: string }[];
  canCreateCustomer: boolean;
  canCreateProduct: boolean;
}) {
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [productOptions, setProductOptions] = useState<ProductOption[]>(products);
  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>(customers);
  const [customerId, setCustomerId] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");
  const [showCandidates, setShowCandidates] = useState(false);

  const selectedCustomer = customerOptions.find((c) => String(c.id) === customerId);
  const candidates = (() => {
    const kw = customerQuery.trim();
    return (kw ? customerOptions.filter((c) => c.name.includes(kw)) : customerOptions).slice(0, 30);
  })();

  function onCustomerQueryChange(value: string) {
    setCustomerQuery(value);
    // 输入与当前选中名不一致即视为重新搜索，清空选中
    if (value !== selectedCustomer?.name) setCustomerId("");
    setShowCandidates(true);
  }

  function chooseCustomer(c: CustomerOption) {
    setCustomerId(String(c.id));
    setCustomerQuery(c.name);
    setShowCandidates(false);
  }
  const [showCreateProduct, setShowCreateProduct] = useState(false);
  const [newProduct, setNewProduct] = useState({
    name: "",
    spec: "",
    manufacturer: "",
    categoryId: "",
    unitId: "",
    refSalePrice: "",
    refPurchasePrice: "",
    minStock: "1",
  });
  const [productMsg, setProductMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [mfrQuery, setMfrQuery] = useState("");
  const [mfrOpen, setMfrOpen] = useState(false);
  const mfrHits = (() => {
    const kw = mfrQuery.trim().toLowerCase();
    return kw ? suppliers.filter((s) => s.name.toLowerCase().includes(kw)).slice(0, 30) : [];
  })();
  const [productPending, startProductTransition] = useTransition();
  const [showCreateCustomer, setShowCreateCustomer] = useState(false);
  const [createCustomerMsg, setCreateCustomerMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [createPending, startCreateTransition] = useTransition();
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createSaleOrderAction,
    null
  );

  const [newCustomer, setNewCustomer] = useState({ name: "", contact: "", phone: "" });
  const [categoryOptions, setCategoryOptions] = useState(categories);
  const [unitOptions, setUnitOptions] = useState(units);
  const [showQuickCategory, setShowQuickCategory] = useState(false);
  const [showQuickUnit, setShowQuickUnit] = useState(false);
  const [quickOptionName, setQuickOptionName] = useState("");
  const [quickGroupOptions, setQuickGroupOptions] = useState(customerGroups);
  const [quickTagOptions, setQuickTagOptions] = useState(customerTags);
  const [newCustomerGroupId, setNewCustomerGroupId] = useState("");
  const [newCustomerTagIds, setNewCustomerTagIds] = useState<number[]>([]);
  const [showQuickGroup, setShowQuickGroup] = useState(false);
  const [showQuickTag, setShowQuickTag] = useState(false);
  const [quickOrgName, setQuickOrgName] = useState("");
  const [quickOrgMsg, setQuickOrgMsg] = useState<{ error?: string } | null>(null);

  function onCreateCustomer() {
    if (!newCustomer.name.trim()) {
      setCreateCustomerMsg({ error: "请填写客户名称" });
      return;
    }
    startCreateTransition(async () => {
      const result: QuickCustomerResult = await createQuickCustomerAction({
        name: newCustomer.name,
        contact: newCustomer.contact,
        phone: newCustomer.phone,
        groupId: newCustomerGroupId ? Number(newCustomerGroupId) : null,
        tagIds: newCustomerTagIds,
      });
      if ("error" in result) {
        setCreateCustomerMsg({ error: result.error });
        return;
      }
      const opt = {
        ...result,
        groupName: quickGroupOptions.find((g) => String(g.id) === newCustomerGroupId)?.name ?? "",
        tagNames: quickTagOptions
          .filter((t) => newCustomerTagIds.includes(t.id))
          .map((t) => t.name),
      };
      setCustomerOptions((prev) =>
        prev.some((c) => c.id === result.id) ? prev : [...prev, opt]
      );
      chooseCustomer(opt);
      setShowCreateCustomer(false);
      setNewCustomer({ name: "", contact: "", phone: "" });
      setNewCustomerGroupId("");
      setNewCustomerTagIds([]);
      setCreateCustomerMsg({ ok: `客户「${result.name}」已创建并选中` });
      setTimeout(() => setCreateCustomerMsg(null), 4000);
    });
  }

  function quickCreateCategory() {
    const name = quickOptionName.trim();
    if (!name) return;
    startProductTransition(async () => {
      const r: QuickCategoryResult = await createQuickCategoryAction({ name });
      if ("error" in r) {
        setProductMsg({ error: r.error });
        return;
      }
      setCategoryOptions((prev) => (prev.some((c) => c.id === r.id) ? prev : [...prev, { id: r.id, name: r.name }]));
      setNewProduct((p) => ({ ...p, categoryId: String(r.id) }));
      setShowQuickCategory(false);
      setQuickOptionName("");
      setQuickOrgMsg(null);
      setQuickOrgMsg({});
    });
  }

  function quickCreateUnit() {
    const name = quickOptionName.trim();
    if (!name) return;
    startProductTransition(async () => {
      const r: QuickUnitResult = await createQuickUnitAction({ name });
      if ("error" in r) {
        setProductMsg({ error: r.error });
        return;
      }
      setUnitOptions((prev) => (prev.some((u) => u.id === r.id) ? prev : [...prev, { id: r.id, name: r.name }]));
      setNewProduct((p) => ({ ...p, unitId: String(r.id) }));
      setShowQuickUnit(false);
      setQuickOptionName("");
      setQuickOrgMsg({});
    });
  }

  function quickCreateGroup() {
    const name = quickOrgName.trim();
    if (!name) return;
    startCreateTransition(async () => {
      const r: QuickResult = await createQuickCustomerGroupAction({ name });
      if ("error" in r) {
        setQuickOrgMsg({ error: r.error });
        return;
      }
      setQuickGroupOptions((prev) => (prev.some((g) => g.id === r.id) ? prev : [...prev, { id: r.id, name: r.name }]));
      setNewCustomerGroupId(String(r.id));
      setQuickOrgName("");
      setShowQuickGroup(false);
      setQuickOrgMsg(null);
    });
  }

  function quickCreateTag() {
    const name = quickOrgName.trim();
    if (!name) return;
    startCreateTransition(async () => {
      const r: QuickResult = await createQuickCustomerTagAction({ name });
      if ("error" in r) {
        setQuickOrgMsg({ error: r.error });
        return;
      }
      setQuickTagOptions((prev) => (prev.some((t) => t.id === r.id) ? prev : [...prev, { id: r.id, name: r.name }]));
      setNewCustomerTagIds((prev) => (prev.includes(r.id) ? prev : [...prev, r.id]));
      setQuickOrgName("");
      setShowQuickTag(false);
      setQuickOrgMsg(null);
    });
  }

  function emptyRow(): Row {
    return {
      productId: "",
      productLabel: "",
      productCode: "",
      productQuery: "",
      manufacturer: "",
      unitName: "",
      stockQty: 0,
      quantity: "",
      unitPrice: "",
      supplierId: "",
      supplyPrice: "",
      hasLastSupplier: false,
    };
  }

  // 商品候选弹层（fixed 定位，避免被表格 overflow 裁剪）
  const [productPanel, setProductPanel] = useState<{ index: number; top: number; left: number; width: number } | null>(null);

  function searchProducts(row: Row | undefined): ProductOption[] {
    if (!row) return [];
    const kws = [row.productCode.trim(), row.productQuery.trim()]
      .map((v) => v.toLowerCase())
      .filter(Boolean);
    if (kws.length === 0) return [];
    return productOptions
      .filter((p) => {
        const hay = [p.code, p.name, p.manufacturer, p.spec]
          .join(" ")
          .toLowerCase();
        return kws.every((kw) => hay.includes(kw));
      })
      .slice(0, 30);
  }

  function openProductPanel(e: React.FocusEvent<HTMLInputElement>, index: number) {
    const rect = e.currentTarget.getBoundingClientRect();
    setProductPanel({ index, top: rect.bottom + 4, left: rect.left, width: rect.width });
  }

  function onProductInputChange(index: number, field: "code" | "name", value: string) {
    setRows((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        // 输入与选中商品不一致 = 重新搜索，清空该行选中
        const stillSelected =
          value === (field === "code" ? row.productCode : row.productQuery) &&
          value.length > 0;
        const matchNote = stillSelected || !row.productId ? true : false;
        if (!matchNote) {
          return {
            ...row,
            productId: "",
            productCode: field === "code" ? value : row.productCode,
            productQuery: field === "name" ? value : row.productQuery,
            unitName: "",
            stockQty: 0,
            unitPrice: "",
            supplierId: "",
            supplyPrice: "",
            hasLastSupplier: false,
          };
        }
        return {
          ...row,
          productCode: field === "code" ? value : row.productCode,
          productQuery: field === "name" ? value : row.productQuery,
        };
      })
    );
  }

  function chooseProduct(index: number, p: ProductOption) {
    setRows((prev) =>
      prev.map((row, i) =>
        i === index
          ? {
              ...row,
              productId: String(p.id),
              productLabel: `${p.code} ${p.name}`,
              productCode: p.code,
              productQuery: p.name,
              manufacturer: p.manufacturer,
              unitName: p.unitName,
              stockQty: p.stockQty,
              unitPrice: String(p.refSalePrice),
              supplierId: p.lastSupplierId != null ? String(p.lastSupplierId) : "",
              supplyPrice: String(p.lastSupplyPrice),
              hasLastSupplier: p.lastSupplierId != null,
            }
          : row
      )
    );
    setProductPanel(null);
  }

  function shortfall(row: Row): number {
    const q = Number(row.quantity);
    if (!Number.isFinite(q) || q <= 0) return 0;
    return Math.max(q - row.stockQty, 0);
  }

  function lineAmount(row: Row): number {
    const q = Number(row.quantity);
    const price = Number(row.unitPrice);
    return Number.isFinite(q) && Number.isFinite(price) ? q * price : 0;
  }

  function onCreateProduct() {
    if (!newProduct.name.trim()) {
      setProductMsg({ error: "请填写商品名称" });
      return;
    }
    if (!newProduct.unitId) {
      setProductMsg({ error: "请选择单位" });
      return;
    }
    if (!mfrQuery.trim()) {
      setProductMsg({ error: "请选择或新建厂商/生产厂家" });
      return;
    }
    startProductTransition(async () => {
      const result: QuickProductResult = await createQuickProductAction({
        name: newProduct.name,
        manufacturer: mfrQuery.trim(),
        categoryId: newProduct.categoryId ? Number(newProduct.categoryId) : null,
        unitId: Number(newProduct.unitId),
        refPurchasePrice: Number(newProduct.refPurchasePrice) || 0,
        minStock: Number(newProduct.minStock) || 1,
      });
      if ("error" in result) {
        setProductMsg({ error: result.error });
        return;
      }
      const mfrSupplierId =
        suppliers.find((s) => s.name === result.manufacturer.trim())?.id ?? null;
      const opt: ProductOption = {
        id: result.id,
        label: `${result.code} ${result.name}（${result.manufacturer}）`,
        code: result.code,
        name: result.name,
        spec: "",
        manufacturer: result.manufacturer,
        unitName: result.unitName,
        stockQty: 0,
        refSalePrice: result.refSalePrice,
        lastSupplierId: mfrSupplierId,
        lastSupplyPrice: result.refPurchasePrice,
      };
      setProductOptions((prev) => (prev.some((p) => p.id === result.id) ? prev : [...prev, opt]));
      // 自动追加一行商品并选中新商品（库存 0 → 走缺货补货流程）
      setRows((prev) => [
        ...prev,
        {
          productId: String(result.id),
          productLabel: `${result.code} ${result.name}`,
          productCode: result.code,
          productQuery: result.name,
          manufacturer: result.manufacturer,
          unitName: result.unitName,
          stockQty: 0,
          quantity: "",
          unitPrice: String(result.refSalePrice),
          supplierId: "",
          supplyPrice: String(result.refPurchasePrice),
          hasLastSupplier: false,
        },
      ]);
      setShowCreateProduct(false);
      setNewProduct({ name: "", spec: "", manufacturer: "", categoryId: "", unitId: "", refSalePrice: "", refPurchasePrice: "", minStock: "1" });
      setMfrQuery("");
      setProductMsg({ ok: `商品「${result.name}」已创建（${result.code}），已加入商品行` });
      setTimeout(() => setProductMsg(null), 5000);
    });
  }

  const total = rows.reduce((s, r) => s + lineAmount(r), 0);

  return (
    <form action={formAction} className="space-y-4">
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-gray-200 bg-white p-5">
        <div className="min-w-64">
          <label htmlFor="customerQuery" className="block text-xs font-medium text-gray-600">
            客户 *
          </label>
          <div className="mt-1 flex items-center gap-2">
            <div className="relative flex-1">
              <input
                id="customerQuery"
                name="customerQuery"
                type="text"
                autoComplete="off"
                placeholder="输入客户名称，边输入边弹候选…"
                value={customerQuery}
                onChange={(e) => onCustomerQueryChange(e.target.value)}
                onFocus={() => setShowCandidates(true)}
                onBlur={() => setShowCandidates(false)}
                className={`w-full ${inputCls} pr-32`}
              />
              {customerId && selectedCustomer && (
                <div className="pointer-events-none absolute inset-y-0 right-2 top-1 flex items-center gap-1">
                  {selectedCustomer.groupName && (
                    <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] leading-none text-blue-700">
                      {selectedCustomer.groupName}
                    </span>
                  )}
                  {selectedCustomer.tagNames.slice(0, 2).map((t) => (
                    <span key={t} className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] leading-none text-gray-600">
                      {t}
                    </span>
                  ))}
                  {selectedCustomer.tagNames.length > 2 && (
                    <span className="text-[10px] text-gray-400">
                      +{selectedCustomer.tagNames.length - 2}
                    </span>
                  )}
                </div>
              )}
              <input type="hidden" name="customerId" value={customerId} />
              {showCandidates && customerQuery && (
                <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
                  {candidates.length === 0 && (
                    <div className="px-3 py-2 text-xs text-gray-400">无匹配客户</div>
                  )}
                  {candidates.map((c) => (
                    <button
                      type="button"
                      key={c.id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => chooseCustomer(c)}
                      className="block w-full px-3 py-2 text-left text-sm text-gray-900 hover:bg-blue-50"
                    >
                      <span className="font-medium">{c.name}</span>
                      {c.groupName && (
                        <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{c.groupName}</span>
                      )}
                      {c.tagNames.map((t) => (
                        <span key={t} className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{t}</span>
                      ))}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {canCreateCustomer && (
              <button
                type="button"
                onClick={() => {
                  setShowCreateCustomer((v) => !v);
                  setCreateCustomerMsg(null);
                }}
                className="shrink-0 rounded-md border border-blue-300 px-2.5 py-1.5 text-xs text-blue-600 hover:bg-blue-50"
              >
                {showCreateCustomer ? "取消" : "+ 新建客户"}
              </button>
            )}
          </div>

          {showCreateCustomer && (
            <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3 space-y-2">
              <input
                type="text"
                maxLength={100}
                placeholder="客户名称（必填）"
                value={newCustomer.name}
                onChange={(e) => setNewCustomer((p) => ({ ...p, name: e.target.value }))}
                className="block w-full rounded-md border border-blue-200 px-2 py-1.5 text-sm text-gray-900"
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  maxLength={50}
                  placeholder="联系人"
                  value={newCustomer.contact}
                  onChange={(e) => setNewCustomer((p) => ({ ...p, contact: e.target.value }))}
                  className="block w-full rounded-md border border-blue-200 px-2 py-1.5 text-sm text-gray-900"
                />
                <input
                  type="text"
                  maxLength={30}
                  placeholder="电话"
                  value={newCustomer.phone}
                  onChange={(e) => setNewCustomer((p) => ({ ...p, phone: e.target.value }))}
                  className="block w-full rounded-md border border-blue-200 px-2 py-1.5 text-sm text-gray-900"
                />
              </div>

              {/* 组织选择 + 快捷新建 */}
              <div className="flex items-center gap-2">
                <select
                  value={newCustomerGroupId}
                  onChange={(e) => setNewCustomerGroupId(e.target.value)}
                  className="w-full rounded-md border border-blue-200 px-2 py-1.5 text-sm text-gray-900"
                >
                  <option value="">所属组织（可选）</option>
                  {quickGroupOptions.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => { setShowQuickGroup((v) => !v); setShowQuickTag(false); setQuickOrgName(""); }}
                  className="shrink-0 rounded-md border border-blue-300 px-2 py-1.5 text-xs text-blue-600 hover:bg-blue-50"
                >
                  {showQuickGroup ? "取消" : "+ 组织"}
                </button>
              </div>
              {showQuickGroup && (
                <div className="flex items-center gap-1">
                  <input
                    placeholder="新组织名称"
                    maxLength={50}
                    value={quickOrgName}
                    onChange={(e) => setQuickOrgName(e.target.value)}
                    className="w-full rounded-md border border-blue-200 px-2 py-1.5 text-sm text-gray-900"
                  />
                  <button type="button" onClick={quickCreateGroup} disabled={createPending}
                    className="shrink-0 rounded-md bg-blue-600 px-2 py-1 text-xs text-white disabled:opacity-50">
                    {createPending ? "…" : "创建"}
                  </button>
                </div>
              )}

              {/* 标签选择 + 快捷新建 */}
              <div className="flex flex-wrap items-center gap-2">
                {quickTagOptions.map((t) => (
                  <label
                    key={t.id}
                    className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs cursor-pointer ${
                      newCustomerTagIds.includes(t.id)
                        ? "border-blue-300 bg-blue-50 text-blue-700"
                        : "border-gray-200 bg-white text-gray-600"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={newCustomerTagIds.includes(t.id)}
                      onChange={() =>
                        setNewCustomerTagIds((prev) =>
                          prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id]
                        )
                      }
                      className="sr-only"
                    />
                    {t.name}
                  </label>
                ))}
                <button
                  type="button"
                  onClick={() => { setShowQuickTag((v) => !v); setShowQuickGroup(false); setQuickOrgName(""); }}
                  className="rounded-full border border-dashed border-blue-300 px-2.5 py-1 text-xs text-blue-600 hover:bg-blue-50"
                >
                  {showQuickTag ? "取消" : "+ 标签"}
                </button>
                {showQuickTag && (
                  <>
                    <input
                      placeholder="新标签名称"
                      maxLength={30}
                      value={quickOrgName}
                      onChange={(e) => setQuickOrgName(e.target.value)}
                      className="w-28 rounded-md border border-blue-200 px-2 py-1 text-xs text-gray-900"
                    />
                    <button type="button" onClick={quickCreateTag} disabled={createPending}
                      className="rounded-md bg-blue-600 px-2 py-1 text-xs text-white disabled:opacity-50">
                      {createPending ? "…" : "创建"}
                    </button>
                  </>
                )}
              </div>
              {quickOrgMsg?.error && <p className="text-xs text-red-600">{quickOrgMsg.error}</p>}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onCreateCustomer}
                  disabled={createPending}
                  className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {createPending ? "创建中…" : "创建并选用"}
                </button>
                {createCustomerMsg?.ok && <span className="text-xs text-green-600">{createCustomerMsg.ok}</span>}
                {createCustomerMsg?.error && <span className="text-xs text-red-600">{createCustomerMsg.error}</span>}
              </div>
            </div>
          )}
        </div>
        <div className="min-w-56 flex-1">
          <label htmlFor="sale-remark" className="block text-xs font-medium text-gray-600">
            备注
          </label>
          <input
            id="sale-remark"
            name="remark"
            type="text"
            maxLength={200}
            placeholder="选填"
            className={`mt-1 ${inputCls}`}
          />
        </div>
      </div>

      {canCreateProduct && showCreateProduct && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-900">新建商品（编码自动生成）</span>
            <button
              type="button"
              onClick={() => setShowCreateProduct(false)}
              className="text-xs text-gray-400 hover:underline"
            >
              收起
            </button>
          </div>
<div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div>
                <label className="block text-xs font-medium text-gray-600">商品名称（完整名称，含规格）*</label>
                <input
                  type="text"
                  maxLength={100}
                  placeholder="商品名称（必填）"
                  value={newProduct.name}
                  onChange={(e) => setNewProduct((p) => ({ ...p, name: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600">厂商（生产厂家）*，选择或新建供应商档案</label>
                <div className="relative mt-1">
                  <input
                    type="text"
                    autoComplete="off"
                    placeholder="输入厂商名搜索供应商档案…"
                    value={mfrQuery}
                    onChange={(e) => { setMfrQuery(e.target.value); setMfrOpen(true); }}
                    onFocus={() => setMfrOpen(true)}
                    onBlur={() => setTimeout(() => setMfrOpen(false), 150)}
                    className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
                  />
                  {mfrOpen && mfrQuery.trim() && (
                    <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
                      {mfrHits.length === 0 && <div className="px-3 py-2 text-xs text-gray-400">无匹配厂商</div>}
                      {mfrHits.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => { setMfrQuery(s.name); setMfrOpen(false); }}
                          className="block w-full px-3 py-2 text-left text-sm text-gray-900 hover:bg-blue-50"
                        >
                          {s.name}
                        </button>
                      ))}
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          startProductTransition(async () => {
                            const r = await createQuickSupplierAction({ name: mfrQuery.trim() });
                            if ("error" in r) {
                              setProductMsg({ error: r.error });
                              return;
                            }
                            setMfrQuery(r.name);
                            setMfrOpen(false);
                          });
                        }}
                        disabled={productPending}
                        className="block w-full border-t border-gray-100 px-3 py-2 text-left text-sm text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                      >
                        ＋ 新建厂商：「{mfrQuery.trim()}」
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600">分类</label>
                <div className="mt-1 flex items-center gap-1">
                  <select
                    name="quickCategory"
                    value={newProduct.categoryId}
                    onChange={(e) => setNewProduct((p) => ({ ...p, categoryId: e.target.value }))}
                    className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
                  >
                    <option value="">未分类</option>
                    {categoryOptions.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => { setShowQuickCategory((v) => !v); setShowQuickUnit(false); setQuickOptionName(""); }}
                    className="shrink-0 rounded-md border border-blue-300 px-2 py-1.5 text-xs text-blue-600 hover:bg-blue-50"
                  >
                    {showQuickCategory ? "取消" : "+ 分类"}
                  </button>
                </div>
                {showQuickCategory && (
                  <div className="mt-1 flex items-center gap-1">
                    <input
                      placeholder="新分类名称"
                      maxLength={50}
                      value={quickOptionName}
                      onChange={(e) => setQuickOptionName(e.target.value)}
                      className="w-full rounded-md border border-blue-200 px-2 py-1.5 text-sm text-gray-900"
                    />
                    <button type="button" onClick={quickCreateCategory} disabled={productPending}
                      className="shrink-0 rounded-md bg-blue-600 px-2 py-1 text-xs text-white disabled:opacity-50">
                      {productPending ? "…" : "创建"}
                    </button>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600">单位 *</label>
                <div className="mt-1 flex items-center gap-1">
                  <select
                    name="quickUnit"
                    value={newProduct.unitId}
                    onChange={(e) => setNewProduct((p) => ({ ...p, unitId: e.target.value }))}
                    className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
                  >
                    <option value="">请选择</option>
                    {unitOptions.map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => { setShowQuickUnit((v) => !v); setShowQuickCategory(false); setQuickOptionName(""); }}
                    className="shrink-0 rounded-md border border-blue-300 px-2 py-1.5 text-xs text-blue-600 hover:bg-blue-50"
                  >
                    {showQuickUnit ? "取消" : "+ 单位"}
                  </button>
                </div>
                {showQuickUnit && (
                  <div className="mt-1 flex items-center gap-1">
                    <input
                      placeholder="新单位名称"
                      maxLength={20}
                      value={quickOptionName}
                      onChange={(e) => setQuickOptionName(e.target.value)}
                      className="w-full rounded-md border border-blue-200 px-2 py-1.5 text-sm text-gray-900"
                    />
                    <button type="button" onClick={quickCreateUnit} disabled={productPending}
                      className="shrink-0 rounded-md bg-blue-600 px-2 py-1 text-xs text-white disabled:opacity-50">
                      {productPending ? "…" : "创建"}
                    </button>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600">参考进价</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="参考进价"
                  value={newProduct.refPurchasePrice}
                  onChange={(e) => setNewProduct((p) => ({ ...p, refPurchasePrice: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600">库存预警线（默认 1）</label>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  placeholder="库存预警线"
                  value={newProduct.minStock}
                  onChange={(e) => setNewProduct((p) => ({ ...p, minStock: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
                />
              </div>
              <div className="flex items-end gap-2">
                <button
                  type="button"
                  onClick={onCreateProduct}
                  disabled={productPending}
                  className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {productPending ? "创建中…" : "创建商品并加行"}
                </button>
              </div>
              {(productMsg?.ok || productMsg?.error) && (
                <p className={`col-span-full text-xs ${productMsg.ok ? "text-green-600" : "text-red-600"}`}>
                  {productMsg.ok ?? productMsg.error}
                </p>
              )}
            </div>

        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="w-24 px-4 py-3 font-medium">编码</th>
              <th className="min-w-64 px-4 py-3 font-medium">商品名称 *</th>
              <th className="w-20 px-4 py-3 font-medium">库存</th>
              <th className="w-28 px-4 py-3 font-medium">数量 *</th>
              <th className="w-16 px-4 py-3 font-medium">单位</th>
              <th className="w-32 px-4 py-3 font-medium">售价 *</th>
              <th className="w-48 px-4 py-3 font-medium">自动补货（缺货时）</th>
              <th className="w-28 px-4 py-3 text-right font-medium">金额</th>
              <th className="w-14 px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row, i) => {
              const sf = shortfall(row);
              return (
                <tr key={i}>
                  <td className="px-4 py-2">
                    <input
                      type="text"
                      autoComplete="off"
                      placeholder="编码"
                      value={row.productCode}
                      onChange={(e) => onProductInputChange(i, "code", e.target.value)}
                      onFocus={(e) => openProductPanel(e, i)}
                      onBlur={() => setProductPanel(null)}
                      className={inputCls}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      name={`item_${i}_productQuery`}
                      type="text"
                      autoComplete="off"
                      placeholder="名称/型号/厂商…"
                      value={row.productQuery}
                      onChange={(e) => onProductInputChange(i, "name", e.target.value)}
                      onFocus={(e) => openProductPanel(e, i)}
                      onBlur={() => setProductPanel(null)}
                      className={inputCls}
                    />
                    <input type="hidden" name={`item_${i}_productId`} value={row.productId} />
                  </td>
                  <td className="px-4 py-2 text-gray-600">{row.unitName ? row.stockQty.toFixed(3) : "—"}</td>
                  <td className="px-4 py-2">
                    <input
                      name={`item_${i}_quantity`}
                      type="number"
                      min="0.001"
                      step="0.001"
                      required
                      value={row.quantity}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((r, j) => (j === i ? { ...r, quantity: e.target.value } : r))
                        )
                      }
                      className={inputCls}
                    />
                  </td>
                  <td className="px-4 py-2 text-gray-600">{row.unitName || "—"}</td>
                  <td className="px-4 py-2">
                    <input
                      name={`item_${i}_unitPrice`}
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      value={row.unitPrice}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((r, j) => (j === i ? { ...r, unitPrice: e.target.value } : r))
                        )
                      }
                      className={inputCls}
                    />
                  </td>
                  <td className="px-4 py-2">
                    {sf > 0 ? (
                      <div className="flex items-center gap-1">
                        <select
                          name={`item_${i}_supplierId`}
                          required={sf > 0}
                          value={row.supplierId}
                          onChange={(e) =>
                            setRows((prev) =>
                              prev.map((r, j) => (j === i ? { ...r, supplierId: e.target.value } : r))
                            )
                          }
                          className={`${inputCls} max-w-28`}
                        >
                          <option value="">补货供应商</option>
                          {suppliers.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                        <input
                          name={`item_${i}_supplyPrice`}
                          type="number"
                          min="0"
                          step="0.01"
                          required={sf > 0}
                          value={row.supplyPrice}
                          onChange={(e) =>
                            setRows((prev) =>
                              prev.map((r, j) => (j === i ? { ...r, supplyPrice: e.target.value } : r))
                            )
                          }
                          className={`${inputCls} max-w-20`}
                        />
                        <span className="whitespace-nowrap text-xs text-amber-600">
                          缺 {sf.toFixed(3)}
                        </span>
                        {row.productId && !row.hasLastSupplier && (
                          <span className="whitespace-nowrap text-xs text-gray-400">
                            {row.manufacturer ? `自动补货：厂商「${row.manufacturer}」` : "请选补货商"}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">
                        {row.hasLastSupplier ? "" : row.productId ? "库存充足" : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-900">{lineAmount(row).toFixed(2)}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setRows((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev))}
                      className="text-xs text-red-500 hover:underline"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setRows((prev) => [...prev, emptyRow()])}
              className="text-sm text-blue-600 hover:underline"
            >
              + 添加商品行
            </button>
            {canCreateProduct && (
              <button
                type="button"
                onClick={() => {
                  setShowCreateProduct((v) => !v);
                  setProductMsg(null);
                }}
                className="rounded-md border border-blue-300 px-2.5 py-1.5 text-xs text-blue-600 hover:bg-blue-50"
              >
                {showCreateProduct ? "收起" : "+ 新建商品"}
              </button>
            )}
          </div>
          <div className="text-sm text-gray-600">
            合计：
            <span className="text-base font-semibold text-gray-900">¥{total.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {productPanel && (() => {
        const row = rows[productPanel.index];
        const hits = searchProducts(row);
        return (
          <div
            style={{ position: "fixed", top: productPanel.top, left: productPanel.left, width: productPanel.width }}
            className="z-50 max-h-64 overflow-auto rounded-md border border-gray-200 bg-white shadow-lg"
          >
            {hits.length === 0 && (
              <div className="px-3 py-2 text-xs text-gray-400">
                无匹配商品（试试厂商、型号、名称、编码）
              </div>
            )}
            {canCreateProduct && row && row.productQuery.trim() && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setProductMsg(null);
                  setNewProduct((prev) => ({ ...prev, name: (row.productCode.trim() + " " + row.productQuery.trim()).trim() }));
                  setShowCreateProduct(true);
                  setProductPanel(null);
                }}
                className="block w-full border-t border-gray-100 px-3 py-2 text-left text-sm text-blue-600 hover:bg-blue-50"
              >
                ＋ 新建商品：「{row.productQuery.trim()}」
              </button>
            )}
            {hits.map((p) => (
              <button
                type="button"
                key={p.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => chooseProduct(productPanel.index, p)}
                className="block w-full px-3 py-2 text-left text-sm text-gray-900 hover:bg-blue-50"
              >
                <span className="font-medium">{p.code} {p.name}</span>
                <span className="ml-2 text-xs text-gray-500">
                  {p.manufacturer}
                  {p.spec ? ` ｜ ${p.spec}` : ""}
                  ｜ 库存 {p.stockQty.toFixed(3)}
                </span>
              </button>
            ))}
          </div>
        );
      })()}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending || !customerId}
          className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? "提交中…" : "提交售卖单"}
        </button>
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state?.ok && <p className="text-sm text-green-600">{state.ok}</p>}
      </div>
    </form>
  );
}
