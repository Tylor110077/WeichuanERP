"use client";

import { useActionState, useState, useTransition } from "react";
import { createSaleOrderAction, type FormState } from "../actions";
import { createQuickCustomerAction, type QuickCustomerResult } from "../../customers/actions";
import { createQuickProductAction, type QuickProductResult } from "../../products/actions";

interface CustomerOption {
  id: number;
  name: string;
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
  productQuery: string; // 输入框当前文本（搜索用）
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
  canCreateCustomer,
  canCreateProduct,
}: {
  customers: CustomerOption[];
  suppliers: SupplierOption[];
  products: ProductOption[];
  units: UnitOption[];
  categories: CategoryOption[];
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
    minStock: "",
  });
  const [productMsg, setProductMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [productPending, startProductTransition] = useTransition();
  const [showCreateCustomer, setShowCreateCustomer] = useState(false);
  const [createCustomerMsg, setCreateCustomerMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [createPending, startCreateTransition] = useTransition();
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createSaleOrderAction,
    null
  );

  const [newCustomer, setNewCustomer] = useState({ name: "", contact: "", phone: "" });

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
      });
      if ("error" in result) {
        setCreateCustomerMsg({ error: result.error });
        return;
      }
      setCustomerOptions((prev) =>
        prev.some((c) => c.id === result.id) ? prev : [...prev, result]
      );
      chooseCustomer(result);
      setShowCreateCustomer(false);
      setNewCustomer({ name: "", contact: "", phone: "" });
      setCreateCustomerMsg({ ok: `客户「${result.name}」已创建并选中` });
      setTimeout(() => setCreateCustomerMsg(null), 4000);
    });
  }

  function emptyRow(): Row {
    return {
      productId: "",
      productLabel: "",
      productQuery: "",
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

  function searchProducts(query: string): ProductOption[] {
    const kw = query.trim().toLowerCase();
    if (!kw) return [];
    return productOptions
      .filter(
        (p) =>
          p.name.toLowerCase().includes(kw) ||
          p.code.toLowerCase().includes(kw) ||
          p.manufacturer.toLowerCase().includes(kw) ||
          p.spec.toLowerCase().includes(kw)
      )
      .slice(0, 30);
  }

  function openProductPanel(e: React.FocusEvent<HTMLInputElement>, index: number) {
    const rect = e.currentTarget.getBoundingClientRect();
    setProductPanel({ index, top: rect.bottom + 4, left: rect.left, width: rect.width });
  }

  function onProductQueryChange(index: number, value: string) {
    setRows((prev) =>
      prev.map((row, i) =>
        i === index
          ? {
              // 输入与选中商品回填文本不一致 = 重新搜索，清空该行选中
              ...row,
              productId: value === row.productLabel && row.productLabel ? row.productId : "",
              productQuery: value,
              unitName: value === row.productLabel && row.productLabel ? row.unitName : "",
              stockQty: value === row.productLabel && row.productLabel ? row.stockQty : 0,
              unitPrice: value === row.productLabel && row.productLabel ? row.unitPrice : "",
              supplierId: value === row.productLabel && row.productLabel ? row.supplierId : "",
              supplyPrice: value === row.productLabel && row.productLabel ? row.supplyPrice : "",
              hasLastSupplier: value === row.productLabel && row.productLabel ? row.hasLastSupplier : false,
            }
          : row
      )
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
              productQuery: `${p.code} ${p.name}`,
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
    if (!newProduct.manufacturer.trim()) {
      setProductMsg({ error: "请填写厂商/生产厂家" });
      return;
    }
    startProductTransition(async () => {
      const result: QuickProductResult = await createQuickProductAction({
        name: newProduct.name,
        spec: newProduct.spec,
        manufacturer: newProduct.manufacturer,
        categoryId: newProduct.categoryId ? Number(newProduct.categoryId) : null,
        unitId: Number(newProduct.unitId),
        refSalePrice: Number(newProduct.refSalePrice) || 0,
        refPurchasePrice: Number(newProduct.refPurchasePrice) || 0,
        minStock: Number(newProduct.minStock) || 0,
      });
      if ("error" in result) {
        setProductMsg({ error: result.error });
        return;
      }
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
        lastSupplierId: null,
        lastSupplyPrice: result.refPurchasePrice,
      };
      setProductOptions((prev) => (prev.some((p) => p.id === result.id) ? prev : [...prev, opt]));
      // 自动追加一行商品并选中新商品（库存 0 → 走缺货补货流程）
      setRows((prev) => [
        ...prev,
        {
          productId: String(result.id),
          productLabel: `${result.code} ${result.name}`,
          productQuery: `${result.code} ${result.name}`,
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
      setNewProduct({ name: "", spec: "", manufacturer: "", categoryId: "", unitId: "", refSalePrice: "", refPurchasePrice: "", minStock: "" });
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
                className={`w-full ${inputCls}`}
              />
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
                      {c.name}
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
        <div className="text-right text-sm text-gray-600">
          合计：
          <span className="text-base font-semibold text-gray-900">¥{total.toFixed(2)}</span>
        </div>
      </div>

      {canCreateProduct && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">
              下拉里没有这个商品？可以当场建档（编码自动生成，默认未上架为启用）。
            </span>
            <button
              type="button"
              onClick={() => {
                setShowCreateProduct((v) => !v);
                setProductMsg(null);
              }}
              className="rounded-md border border-blue-300 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50"
            >
              {showCreateProduct ? "收起" : "+ 新建商品"}
            </button>
          </div>
          {showCreateProduct && (
            <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div>
                <label className="block text-xs font-medium text-gray-600">商品名称 *</label>
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
                <label className="block text-xs font-medium text-gray-600">规格/型号</label>
                <input
                  type="text"
                  maxLength={100}
                  placeholder="规格/型号"
                  value={newProduct.spec}
                  onChange={(e) => setNewProduct((p) => ({ ...p, spec: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600">厂商（生产厂家）*</label>
                <input
                  type="text"
                  maxLength={100}
                  placeholder="如：远东电缆、正泰电器"
                  value={newProduct.manufacturer}
                  onChange={(e) => setNewProduct((p) => ({ ...p, manufacturer: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600">分类</label>
                <select
                  name="quickCategory"
                  value={newProduct.categoryId}
                  onChange={(e) => setNewProduct((p) => ({ ...p, categoryId: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
                >
                  <option value="">未分类</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600">单位 *</label>
                <select
                  name="quickUnit"
                  value={newProduct.unitId}
                  onChange={(e) => setNewProduct((p) => ({ ...p, unitId: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
                >
                  <option value="">请选择</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
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
                <label className="block text-xs font-medium text-gray-600">参考售价</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="参考售价"
                  value={newProduct.refSalePrice}
                  onChange={(e) => setNewProduct((p) => ({ ...p, refSalePrice: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600">库存预警线</label>
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
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">商品 *</th>
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
                      name={`item_${i}_productQuery`}
                      type="text"
                      autoComplete="off"
                      placeholder="搜索名称/型号/厂商/编码…"
                      value={row.productQuery}
                      onChange={(e) => onProductQueryChange(i, e.target.value)}
                      onFocus={(e) => openProductPanel(e, i)}
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
        <div className="border-t border-gray-100 px-4 py-3">
          <button
            type="button"
            onClick={() => setRows((prev) => [...prev, emptyRow()])}
            className="text-sm text-blue-600 hover:underline"
          >
            + 添加商品行
          </button>
        </div>
      </div>

      {productPanel && (() => {
        const row = rows[productPanel.index];
        const hits = row ? searchProducts(row.productQuery) : [];
        return (
          <div
            style={{ position: "fixed", top: productPanel.top, left: productPanel.left, width: productPanel.width }}
            className="z-50 max-h-64 overflow-auto rounded-md border border-gray-200 bg-white shadow-lg"
          >
            {hits.length === 0 && (
              <div className="px-3 py-2 text-xs text-gray-400">
                无匹配商品（试试厂商、型号、名称、编码）{row && row.productQuery ? "" : "，或点击「+ 新建商品」"}
              </div>
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
