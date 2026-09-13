"use client";

import { memo, useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useFormDraft } from "@/lib/form-draft";
import { DraftBanner } from "@/components/draft-banner";
import { btnPrimary, btnSmallPrimary, inputBase } from "@/lib/ui";
import { SearchSelect } from "@/components/search-select";
import { RowDivider, RowField, readOnlyValue } from "@/components/order-row";
import { createPurchaseOrderAction, type FormState } from "../actions";
import { FormStateAlert } from "@/components/form-alert";
import { createQuickSupplierAction } from "../../suppliers/actions";
import { createQuickProductAction } from "../../products/actions";
import {
  searchProductsForPurchase,
  searchSuppliersForPurchase,
} from "./search-actions";

interface SupplierOption {
  id: number;
  name: string;
  py?: string;
}
interface CategoryOption {
  id: number;
  name: string;
  py?: string;
}
interface UnitOption {
  id: number;
  name: string;
  py?: string;
}

interface ProductOption {
  id: number;
  label: string;
  py?: string;
  unitId: number;
  unitName: string;
  refPrice: number;
}

interface Row {
  productId: string;
  /** 选中商品的显示名（编码 + 名称）：草稿恢复时用它把下拉的显示补回来 */
  productLabel: string;
  unitName: string;
  quantity: string;
  unitPrice: string;
  /** 行备注（如包装、交货要求） */
  remark: string;
}

/** 草稿里存的内容：只是"用户填了什么"，商品/厂家的展示信息由目录重新渲染 */
interface PurchaseDraft {
  rows: Row[];
  supplierId: string;
  remark: string;
  starred: boolean;
}

const inputCls = `w-full ${inputBase}`;
/** 数字输入：等宽数字，同行上下对齐 */
const inputNumCls = `${inputCls} tabular-nums`;

export function NewOrderForm({
  suppliers,
  products,
  categories,
  units,
  currentUserId,
  canCreateProduct,
  canCreateSupplier,
  prefill = null,
}: {
  suppliers: SupplierOption[];
  products: ProductOption[];
  /** 商品可能上千：首屏只带"最近进过货的"，其余靠 onSearch 按需搜 */
  categories: CategoryOption[];
  units: UnitOption[];
  /** 能否在开单时当场新建商品 / 厂家（与售卖单一致：仅管理员） */
  canCreateProduct: boolean;
  canCreateSupplier: boolean;
  /** 当前用户 id：草稿按人存，同一台电脑换人登录不会串 */
  currentUserId: number;
  /** 「改单」带进来的原单内容（原单此时应已作废）：用来预填表单 */
  prefill?: {
    orderId: number;
    orderNo: string;
    voided: boolean;
    supplierId: string;
    remark: string;
    starred: boolean;
    rows: {
      productId: string;
      productLabel: string;
      unitName: string;
      quantity: string;
      unitPrice: string;
      remark: string;
    }[];
  } | null;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    prefill ? prefill.rows.map((r) => ({ ...r })) : [emptyRow()]
  );
  const [supplierId, setSupplierId] = useState(prefill?.supplierId ?? "");
  /** 单据备注：原先是不受控输入，做草稿必须能取到值，改成受控 */
  const [orderRemark, setOrderRemark] = useState(prefill?.remark ?? "");
  /** 星标：开单时就标记"重要单据"，随表单提交 */
  const [starred, setStarred] = useState(prefill?.starred ?? false);
  // 现场新建的厂家/商品并入候选（远程搜到的也记下来，选中时才能取到单位与默认价）
  const [extraSuppliers, setExtraSuppliers] = useState<SupplierOption[]>([]);
  const [knownProducts, setKnownProducts] = useState<Record<string, ProductOption>>(() =>
    Object.fromEntries(products.map((p) => [String(p.id), p]))
  );
  // 改单预填的商品可能不在首屏候选里，补进候选，否则下拉只显示空白
  const [extraProducts, setExtraProducts] = useState<ProductOption[]>(() =>
    prefill
      ? prefill.rows
          .filter((r) => !products.some((p) => String(p.id) === r.productId))
          .map((r) => ({
            id: Number(r.productId),
            label: r.productLabel,
            unitId: 0,
            unitName: r.unitName,
            refPrice: Number(r.unitPrice) || 0,
          }))
      : []
  );
  // 现场新建厂家 / 商品（商品记录是哪一行触发的）
  const [creatingSupplier, setCreatingSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [supplierMsg, setSupplierMsg] = useState<{ error?: string; ok?: string } | null>(null);
  const [creatingProductRow, setCreatingProductRow] = useState<number | null>(null);
  const [newProduct, setNewProduct] = useState({
    name: "",
    /** 厂家：存厂家档案 id（下拉按 id 选），提交时解析成名称交给 action */
    manufacturerId: "",
    categoryId: "",
    unitId: "",
    refPurchasePrice: "",
  });
  const [productMsg, setProductMsg] = useState<{ error?: string; ok?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const supplierOptions = [...suppliers, ...extraSuppliers];
  /** 用 useMemo 固定引用：行组件（PurchaseRow）把它当 props，引用一变 memo 就全失效 */
  const productOptions = useMemo(() => [...products, ...extraProducts], [products, extraProducts]);
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createPurchaseOrderAction,
    null
  );

  function emptyRow(): Row {
    return { productId: "", productLabel: "", unitName: "", quantity: "", unitPrice: "", remark: "" };
  }

  /** 把某个候选填进某一行（新建商品后也走这里：闭包里还没有这个候选，必须显式传进来） */
  function applyProduct(index: number, p: ProductOption | undefined) {
    setRows((prev) =>
      prev.map((row, i) =>
        i === index
          ? {
              ...row,
              productId: p ? String(p.id) : "",
              productLabel: p?.label ?? "",
              unitName: p?.unitName ?? "",
              unitPrice: p ? String(p.refPrice) : "",
            }
          : row
      )
    );
  }

  function onProductChange(index: number, productId: string) {
    applyProduct(index, knownProducts[productId]);
  }

  /** 远程搜厂家：结果并入候选表，供选中时取名字 */
  async function searchSuppliers(keyword: string) {
    const list = await searchSuppliersForPurchase(keyword);
    setExtraSuppliers((prev) => {
      const seen = new Set(prev.map((x) => x.id));
      return [...prev, ...list.filter((x) => !seen.has(x.id)).map((x) => ({ id: x.id, name: x.name, py: x.py ?? "" }))];
    });
    return list.map((x) => ({ value: String(x.id), label: x.name, py: x.py ?? "" }));
  }

  /** 远程搜商品：结果并入候选表（拿到单位与默认进价，选中时才能预填） */
  async function searchProducts(keyword: string) {
    const list = await searchProductsForPurchase(keyword);
    setKnownProducts((prev) => {
      const next = { ...prev };
      for (const o of list) next[String(o.id)] = o;
      return next;
    });
    return list.map((o) => ({ value: String(o.id), label: o.label, py: o.py ?? "" }));
  }

  // ---- 就地新建厂家（下拉里点「＋ 新建厂家：「名字」」）----
  function startCreateSupplier(name: string) {
    setNewSupplierName(name);
    setSupplierMsg(null);
    setCreatingSupplier(true);
  }

  async function submitSupplier() {
    const name = newSupplierName.trim();
    if (!name) {
      setSupplierMsg({ error: "请填写厂家名称" });
      return;
    }
    setBusy(true);
    const r = await createQuickSupplierAction({ name });
    setBusy(false);
    if ("error" in r) {
      setSupplierMsg({ error: r.error });
      return;
    }
    setExtraSuppliers((prev) => [...prev.filter((x) => x.id !== r.id), { id: r.id, name: r.name, py: r.py ?? "" }]);
    setSupplierId(String(r.id)); // 建完直接选中，省一次点选
    setCreatingSupplier(false);
    setNewSupplierName("");
    setSupplierMsg({ ok: `已新建厂家「${r.name}」并选中` });
  }

  // ---- 就地新建商品（商品行下拉里点「＋ 新建商品：「名字」」）----
  function startCreateProduct(index: number, name: string) {
    setNewProduct({
      name,
      // 默认就地取上面已选的厂家：开单时"这批货就是这个厂家的"是最常见的情况
      manufacturerId: supplierId || "",
      categoryId: "",
      unitId: units[0] ? String(units[0].id) : "",
      refPurchasePrice: "",
    });
    setCreatingProductRow(index);
    setProductMsg(null);
  }

  async function submitProduct() {
    if (creatingProductRow == null) return;
    const data = newProduct;
    const manufacturerName = supplierOptions.find((x) => String(x.id) === data.manufacturerId)?.name ?? "";
    if (!data.name.trim()) {
      setProductMsg({ error: "请填写商品名称" });
      return;
    }
    if (!manufacturerName) {
      setProductMsg({ error: "请选择厂家（缺货补货、对账都按厂家走）" });
      return;
    }
    if (!data.unitId) {
      setProductMsg({ error: "请选择单位" });
      return;
    }
    setBusy(true);
    const r = await createQuickProductAction({
      name: data.name.trim(),
      manufacturer: manufacturerName,
      categoryId: data.categoryId ? Number(data.categoryId) : null,
      unitId: Number(data.unitId),
      refPurchasePrice: Number(data.refPurchasePrice) || 0,
    });
    setBusy(false);
    if ("error" in r) {
      setProductMsg({ error: r.error });
      return;
    }
    const opt: ProductOption = {
      id: r.id,
      label: `${r.code} ${r.name}（${r.manufacturer || "未填厂家"}）`,
      unitId: r.unitId,
      unitName: r.unitName,
      refPrice: Number(data.refPurchasePrice) || 0,
    };
    setKnownProducts((prev) => ({ ...prev, [String(opt.id)]: opt }));
    setExtraProducts((prev) => [...prev, opt]);
    applyProduct(creatingProductRow, opt); // 建完直接选到那一行（单位、进价一起带上）
    setCreatingProductRow(null);
    setProductMsg({ ok: `已新建商品「${r.name}」并选到第 ${creatingProductRow + 1} 行` });
  }

  /**
   * 「+ 新建商品」按钮：优先用还没选商品的空行，没有就新加一行（与售卖单同一套做法）。
   * 没有它的话，新建入口只藏在下拉里、还得先打字才出现，容易以为"进货单不能新建商品"。
   */
  function openCreateProduct() {
    if (creatingProductRow != null) {
      setCreatingProductRow(null);
      setProductMsg(null);
      return;
    }
    const blank = rows.findIndex((r) => !r.productId);
    if (blank >= 0) {
      startCreateProduct(blank, "");
      return;
    }
    const next = rows.length;
    setRows((prev) => [...prev, emptyRow()]);
    startCreateProduct(next, "");
  }

  /** 进价下方的提示：这个商品上次进价（没有就留空占位，保证列高一致） */
  function refPriceHint(row: Row): string | undefined {
    const opt = knownProducts[row.productId];
    return opt && opt.refPrice > 0 ? `参考 ¥${opt.refPrice.toFixed(2)}` : undefined;
  }


  // 开单草稿：填到一半切走再回来，内容还在（机制见 lib/form-draft.ts）
  // 从草稿箱点进来会带 ?draft=<id>，指定恢复哪一份；否则恢复最近那份
  const urlDraftId = useSearchParams().get("draft") ?? undefined;
  const draftValue = useMemo(
    () => ({ rows, supplierId, remark: orderRemark, starred }),
    [rows, supplierId, orderRemark, starred]
  );
  /** 草稿箱列表里显示的摘要（存草稿时一起写进去，列表页不用懂单据结构） */
  const draftSummary = useMemo(
    () => ({
      partner: suppliers.find((s) => String(s.id) === supplierId)?.name ?? "",
      lines: rows.filter((r) => !!r.productId).length,
      amount: rows.reduce((s, r) => s + lineAmount(r), 0),
      preview: rows.map((r) => r.productLabel).filter(Boolean).slice(0, 2).join("、"),
    }),
    [rows, supplierId, suppliers]
  );
  const { restoredAt, savedAt, discard, startNew, clearStored } = useFormDraft<PurchaseDraft>({
    scope: "purchase",
    userId: currentUserId,
    draftId: urlDraftId,
    // 改单来的：表单已被原单内容预填，别让旧草稿盖掉
    skipRestore: !!prefill,
    summary: draftSummary,
    value: draftValue,
    // 选了厂家、写了备注、或某行选了商品，才算"有内容"；全空就把草稿删掉
    hasContent: !!supplierId || orderRemark.trim() !== "" || rows.some((r) => !!r.productId),
    apply: (d) => {
      const restoredRows = Array.isArray(d.rows) && d.rows.length > 0 ? d.rows : [emptyRow()];
      setRows(restoredRows);
      setSupplierId(typeof d.supplierId === "string" ? d.supplierId : "");
      setOrderRemark(typeof d.remark === "string" ? d.remark : "");
      setStarred(!!d.starred);
      // 草稿里的商品可能不在首屏候选里（首屏只带"最近进过货的"）：
      // 不补进候选，下拉会显示空白、看着像没选中
      setExtraProducts((prev) => {
        const have = new Set([...products, ...prev].map((p) => String(p.id)));
        const missing = restoredRows
          .filter((r) => r.productId && !have.has(r.productId))
          .map((r) => ({
            id: Number(r.productId),
            label: r.productLabel || `#${r.productId}`,
            unitId: 0,
            unitName: r.unitName ?? "",
            refPrice: 0,
          }));
        return missing.length > 0 ? [...prev, ...missing] : prev;
      });
    },
    onDiscard: () => {
      setRows([emptyRow()]);
      setSupplierId("");
      setOrderRemark("");
      setStarred(false);
    },
  });

  /**
   * 行组件（PurchaseRow）要调的回调：ref 存最新实现 + 一层稳定外壳，
   * 否则每次渲染都是新函数引用，React.memo 会直接失效。
   */
  const rowActionsRef = useRef({ onProductChange, startCreateProduct, refPriceHint, searchProducts });
  useEffect(() => {
    rowActionsRef.current = { onProductChange, startCreateProduct, refPriceHint, searchProducts };
  });
  const rowActions = useMemo(
    () => ({
      onProductChange: (i: number, v: string) => rowActionsRef.current.onProductChange(i, v),
      startCreateProduct: (i: number, name: string) => rowActionsRef.current.startCreateProduct(i, name),
      refPriceHint: (r: Row) => rowActionsRef.current.refPriceHint(r),
      searchProducts: (kw: string) => rowActionsRef.current.searchProducts(kw),
    }),
    []
  );

  const total = rows.reduce((s, r) => s + lineAmount(r), 0);

  return (
    <form action={formAction} className="space-y-4" onSubmit={clearStored}>
      <DraftBanner restoredAt={restoredAt} savedAt={savedAt} onDiscard={discard} onStartNew={startNew} />
      {prefill && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span className="font-medium">
            正在改单：原单 {prefill.orderNo}
            {prefill.voided ? "（已作废）" : "（注意：原单尚未作废）"}
          </span>
          <span className="text-amber-700/90">
            内容已从原单带出；改好提交会生成一张新单并重新计算库存与成本，原单不会恢复。
          </span>
          <Link
            href={`/purchase-orders/${prefill.orderId}`}
            className="text-amber-700 underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            看原单
          </Link>
        </div>
      )}
      {/* 厂家信息（可折叠） */}
      <details open className="rounded-xl border border-gray-200 bg-white">
        <summary className="cursor-pointer rounded-t-xl px-5 py-3 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50">
          厂家信息
          <span className="ml-2 text-xs font-normal text-gray-400">
            {supplierId
              ? suppliers.find((x) => String(x.id) === supplierId)?.name ?? "已选择"
              : "尚未选择厂家"}
          </span>
        </summary>
        <div className="border-t border-gray-100 p-5">
        <div className="min-w-72">
          <label htmlFor="supplierId" className="block text-xs font-medium text-gray-600">
            厂家 *
          </label>
          {/* 首屏只带最近打过交道的厂家，其余输入关键词按需搜；
              搜不到时下拉顶部就是「＋ 新建厂家：「名字」」，点开就地建并自动选中 */}
          <SearchSelect
            key={`po-sup-${supplierId}`}
            name="supplierId"
            options={supplierOptions.map((s) => ({ value: String(s.id), label: s.name, py: s.py ?? "" }))}
            defaultValue={supplierId}
            noneLabel="请选择厂家"
            placeholder="厂家（可搜索；没有就输入名称新建）"
            className="mt-1"
            onChange={setSupplierId}
            onSearch={searchSuppliers}
            createLabel={(k) => `＋ 新建厂家：「${k}」`}
            onCreate={startCreateSupplier}
          />
          {/* 显式入口：下拉里那一条要先把名字打进去才出现，光看搜索框会以为不能新建 */}
          {canCreateSupplier && (
            <button
              type="button"
              onClick={() => {
                if (creatingSupplier) {
                  setCreatingSupplier(false);
                  setNewSupplierName("");
                  setSupplierMsg(null);
                  return;
                }
                startCreateSupplier("");
              }}
              className={`mt-1.5 ${btnSmallPrimary}`}
            >
              {creatingSupplier ? "取消新建厂家" : "+ 新建厂家"}
            </button>
          )}
          {creatingSupplier && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50/50 p-2">
              <span className="text-xs text-gray-600">新建厂家</span>
              <input
                value={newSupplierName}
                onChange={(e) => setNewSupplierName(e.target.value)}
                maxLength={100}
                placeholder="厂家名称"
                className={`${inputBase} w-56`}
              />
              <button type="button" onClick={submitSupplier} disabled={busy} className={btnSmallPrimary}>
                {busy ? "创建中…" : "创建并选中"}
              </button>
              <button
                type="button"
                onClick={() => { setCreatingSupplier(false); setNewSupplierName(""); setSupplierMsg(null); }}
                className="text-xs text-gray-500 hover:underline"
              >
                取消
              </button>
              <p className="basis-full text-xs text-gray-500">
                联系人、电话、地址等可稍后在「商品与厂家 → 厂家管理」里补
              </p>
            </div>
          )}
          {supplierMsg?.error && <p className="mt-1 text-xs text-red-600">{supplierMsg.error}</p>}
          {supplierMsg?.ok && <p className="mt-1 text-xs text-green-700">{supplierMsg.ok}</p>}
        </div>
        </div>
      </details>

      {/* 商品明细与备注（可折叠） */}
      <details open className="rounded-xl border border-gray-200 bg-white">
        <summary className="cursor-pointer rounded-t-xl px-5 py-3 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50">
          商品明细与备注
          <span className="ml-2 text-xs font-normal text-gray-400">
            {rows.length} 行 ・ 合计 ¥{total.toFixed(2)}
          </span>
        </summary>
        <div className="space-y-4 border-t border-gray-100 p-5">
      {/* 单据备注（作用于整张单据，放在商品明细上方） */}
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="remark" className="shrink-0 text-sm text-gray-600">
          单据备注
        </label>
        <input
          id="remark"
          name="remark"
          type="text"
          maxLength={200}
          value={orderRemark}
          onChange={(e) => setOrderRemark(e.target.value)}
          placeholder="选填，如交货方式、包装要求（作用于整张单据）"
          className={`${inputBase} min-w-64 flex-1`}
        />
        {/* 星标：开单时就能标记，开单后在列表/详情也能改 */}
        <input type="hidden" name="starred" value={starred ? "1" : ""} />
        <button
          type="button"
          onClick={() => setStarred((v) => !v)}
          aria-pressed={starred}
          title={starred ? "已标星，点击取消" : "标为重要单据（列表里可只看星标）"}
          className={`shrink-0 rounded-md border px-2.5 py-1.5 text-xs transition ${
            starred
              ? "border-amber-300 bg-amber-50 font-medium text-amber-700 hover:bg-amber-100"
              : "border-gray-300 bg-white text-gray-500 hover:border-amber-300 hover:text-amber-600"
          }`}
        >
          {starred ? "★ 已星标" : "☆ 星标"}
        </button>
      </div>

      {/* 就地新建商品：在商品行下拉里点「＋ 新建商品：「名字」」后出现，建完自动选到那一行 */}
      {creatingProductRow != null && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900">
              新建商品（建完自动选到第 {creatingProductRow + 1} 行）
            </h3>
            <button
              type="button"
              onClick={() => {
                setCreatingProductRow(null);
                setProductMsg(null);
              }}
              className="text-xs text-gray-500 hover:underline"
            >
              取消
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
            <div className="col-span-2 lg:col-span-1">
              <label className="block text-xs font-medium text-gray-600">商品名称 *</label>
              <input
                value={newProduct.name}
                onChange={(e) => setNewProduct((p) => ({ ...p, name: e.target.value }))}
                maxLength={100}
                placeholder="写全名称，如：BV 2.5平方 单芯铜线"
                className={`mt-1 ${inputCls}`}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600">厂家 *</label>
              <SearchSelect
                key={`np-mfr-${newProduct.manufacturerId}`}
                name="quickManufacturer"
                options={supplierOptions.map((x) => ({ value: String(x.id), label: x.name, py: x.py ?? "" }))}
                defaultValue={newProduct.manufacturerId}
                noneLabel="请选择厂家"
                placeholder="搜索厂家"
                className="mt-1"
                onChange={(v) => setNewProduct((p) => ({ ...p, manufacturerId: v }))}
                onSearch={searchSuppliers}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600">单位 *</label>
              <SearchSelect
                key={`np-unit-${newProduct.unitId}`}
                name="quickUnit"
                options={units.map((u) => ({ value: String(u.id), label: u.name, py: u.py ?? "" }))}
                defaultValue={newProduct.unitId}
                noneLabel="请选择单位"
                placeholder="搜索单位"
                className="mt-1"
                onChange={(v) => setNewProduct((p) => ({ ...p, unitId: v }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600">分类</label>
              <SearchSelect
                key={`np-cat-${newProduct.categoryId}`}
                name="quickCategory"
                options={categories.map((c) => ({ value: String(c.id), label: c.name, py: c.py ?? "" }))}
                defaultValue={newProduct.categoryId}
                noneLabel="未分类"
                placeholder="搜索分类"
                className="mt-1"
                onChange={(v) => setNewProduct((p) => ({ ...p, categoryId: v }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600">参考进价</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={newProduct.refPurchasePrice}
                onChange={(e) => setNewProduct((p) => ({ ...p, refPurchasePrice: e.target.value }))}
                placeholder="选填"
                className={`mt-1 ${inputCls}`}
              />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={submitProduct} disabled={busy} className={btnSmallPrimary}>
              {busy ? "创建中…" : "创建并选中"}
            </button>
            <span className="text-xs text-gray-500">
              没有这个厂家？先在「厂家信息」里新建，或在上面的厂家框输入名称新建
            </span>
          </div>
          {productMsg?.error && <p className="mt-2 text-xs text-red-600">{productMsg.error}</p>}
        </div>
      )}

      {/* 新建成功的提示放在面板外：面板一关，里面的字就看不到了 */}
      {productMsg?.ok && creatingProductRow == null && (
        <p className="text-xs text-green-700">{productMsg.ok}</p>
      )}

      {/* 商品清单：每行一个商品，字段标签内联、行间以分隔线区隔 */}
      <div className="divide-y divide-gray-100 border-y border-gray-100">
        {rows.map((row, i) => (
          <PurchaseRow
            key={i}
            row={row}
            i={i}
            setRows={setRows}
            productOptions={productOptions}
            onProductChange={rowActions.onProductChange}
            startCreateProduct={rowActions.startCreateProduct}
            refPriceHint={rowActions.refPriceHint}
            searchProducts={rowActions.searchProducts}
          />
        ))}
      </div>

      {/* 底部操作与合计（去边框） */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setRows((prev) => [...prev, emptyRow()])}
            className={btnSmallPrimary}
          >
            + 添加商品行
          </button>
          {canCreateProduct && (
            <button type="button" onClick={openCreateProduct} className={btnSmallPrimary}>
              {creatingProductRow != null ? "收起" : "+ 新建商品"}
            </button>
          )}
        </div>
        <div className="text-sm text-gray-600">
          合计：
          <span className="text-lg font-semibold tabular-nums text-gray-900">¥{total.toFixed(2)}</span>
        </div>
      </div>

        </div>
      </details>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || !supplierId}
          title={!supplierId ? "请先选择厂家" : undefined}
          className={btnPrimary}
        >
          {pending ? "提交中…" : "提交进货单"}
        </button>
        {!supplierId && (
          <span className="text-sm text-amber-600">请先在上方选择厂家，再提交单据</span>
        )}
        <FormStateAlert state={state} />
      </div>
    </form>
  );
}


// ─────────────────────────── 模块作用域：进货开单行的零件 ───────────────────────────

/** 只依赖 row 的纯计算，行组件与主组件共用，不随渲染重建。 */
function lineAmount(row: Row): number {
  const q = Number(row.quantity);
  const price = Number(row.unitPrice);
  return Number.isFinite(q) && Number.isFinite(price) ? q * price : 0;
}

/**
 * 进货商品行。用 React.memo 包住：只改自己这一行时，其它行不会跟着重渲染。
 * 之前每敲一个字，整张单的所有行都会重渲染一遍；行数一多，弱机上就会卡。
 */
const PurchaseRow = memo(function PurchaseRow({
  row,
  i,
  setRows,
  productOptions,
  onProductChange,
  startCreateProduct,
  refPriceHint,
  searchProducts,
}: {
  row: Row;
  i: number;
  setRows: React.Dispatch<React.SetStateAction<Row[]>>;
  productOptions: ProductOption[];
  onProductChange: (index: number, productId: string) => void;
  startCreateProduct: (index: number, name: string) => void;
  refPriceHint: (row: Row) => string | undefined;
  searchProducts: (keyword: string) => Promise<{ value: string; label: string; py?: string }[]>;
}) {
  // 注意：这里的 JSX 是从 map 里整段搬过来的（含行内逻辑），只补了 return
  return (
          <div key={i} className="py-4">
            {/* 商品 */}
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                {/* 商品同样按需搜索；搜不到可当场新建（建完自动选到本行） */}
                <SearchSelect
                  key={`po-prod-${i}-${row.productId}`}
                  name={`item_${i}_productId`}
                  options={productOptions.map((p) => ({ value: String(p.id), label: p.label, py: p.py ?? "" }))}
                  defaultValue={row.productId}
                  noneLabel="搜索并选择商品"
                  placeholder="商品（可搜索名称 / 编码 / 厂家；没有就输入名称新建）"
                  onChange={(v) => onProductChange(i, v)}
                  onSearch={searchProducts}
                  createLabel={(k) => `＋ 新建商品：「${k}」`}
                  onCreate={(k) => startCreateProduct(i, k)}
                />
              </div>
              <button
                type="button"
                onClick={() => setRows((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev))}
                className="shrink-0 rounded px-1.5 py-1 text-xs text-gray-400 transition hover:bg-red-50 hover:text-red-600"
                title="删除本行"
              >
                删除
              </button>
            </div>

            {row.productId ? (
              <>
                {/* 与销售开单同一套行样式：横向排开不折行（窄屏横向滑动），
                    每列「标签 / 值 / 提示」三层，只读值与输入框同高，列与列之间才对齐 */}
                <div className="scroll-thin mt-3 flex items-start gap-x-3 overflow-x-auto pb-1.5">
                  <RowField label="数量" required className="w-[7.5rem]">
                    <input
                      name={`item_${i}_quantity`}
                      type="number"
                      min="0.001"
                      step="0.001"
                      inputMode="decimal"
                      required
                      value={row.quantity}
                      onChange={(e) =>
                        setRows((prev) => prev.map((r, j) => (j === i ? { ...r, quantity: e.target.value } : r)))
                      }
                      className={inputNumCls}
                    />
                  </RowField>
                  <RowField
                    label="单位"
                    className="w-[5.5rem]"
                    hint={row.unitName ? undefined : "选商品后带出"}
                  >
                    <span className={`${readOnlyValue} text-sm text-gray-700`}>{row.unitName || "—"}</span>
                  </RowField>

                  <RowDivider />

                  <RowField label="进价" required className="w-[7.5rem]" hint={refPriceHint(row)}>
                    <input
                      name={`item_${i}_unitPrice`}
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      value={row.unitPrice}
                      onChange={(e) =>
                        setRows((prev) => prev.map((r, j) => (j === i ? { ...r, unitPrice: e.target.value } : r)))
                      }
                      className={inputNumCls}
                    />
                  </RowField>
                  <RowField label="金额" className="w-[8rem]">
                    <span className={`${readOnlyValue} text-base font-semibold text-gray-900`}>
                      ¥{lineAmount(row).toFixed(2)}
                    </span>
                  </RowField>
                </div>
                {/* 行备注 */}
                <div className="mt-2.5 flex items-center gap-2">
                  <span className="w-14 shrink-0 text-[11px] leading-4 text-gray-500">行备注</span>
                  <input
                    name={`item_${i}_remark`}
                    type="text"
                    maxLength={200}
                    placeholder="选填，如包装、交货要求"
                    value={row.remark}
                    onChange={(e) =>
                      setRows((prev) => prev.map((r, j) => (j === i ? { ...r, remark: e.target.value } : r)))
                    }
                    className={`${inputCls} flex-1`}
                  />
                </div>
              </>
            ) : (
              <p className="mt-2 text-xs text-gray-400">选择商品后填写数量、进价与行备注</p>
            )}
          </div>
  );
});
