"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { badgeInfo, btnPrimary, btnSmallPrimary, btnSmallSolid, inputBase, tagInfo, tagPending } from "@/lib/ui";
import { initials, matchesSearch } from "@/lib/pinyin";
import { useFormDraft } from "@/lib/form-draft";
import { DraftBanner } from "@/components/draft-banner";
import { SearchSelect } from "@/components/search-select";
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
import { FormStateAlert } from "@/components/form-alert";
import { selectAllOnClick, selectAllOnFocus } from "@/components/select-all-on-focus";
import {
  productHintsForOrder,
  searchCustomersForOrder,
  searchProductsForOrder,
  type OrderCustomerOption,
  type OrderProductOption,
} from "./search-actions";

interface CustomerOption {
  id: number;
  name: string;
  groupName: string;
  tagNames: string[];
  /** 拼音首字母串（服务端下发），本地过滤用 */
  py?: string;
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
  /** 拼音首字母串（服务端下发），本地过滤用 */
  py?: string;
}
interface ProductOption {
  id: number;
  label: string;
  code: string;
  name: string;
  manufacturer: string;
  unitName: string;
  stockQty: number;
  /** 拼音首字母串（服务端下发），本地候选过滤用 */
  py?: string;
  /** 当前移动加权均价（库存成本），开单时参考 */
  avgCost: number;
  refSalePrice: number;
  lastSupplierId: number | null;
  lastSupplyPrice: number;
}

interface Row {
  productId: string;
  productLabel: string; // 选中商品的回填文本（编码 + 名称）
  productCode: string; // 编码输入框（分开显示/搜索）
  productQuery: string; // 名称输入框（搜索用）
  manufacturer: string; // 选中商品的厂家（用于"自动补货：厂家"提示）
  unitName: string;
  stockQty: number;
  /** 选中商品时的移动加权均价（参考展示） */
  avgCost: number;
  quantity: string;
  unitPrice: string;
  lastGlobalSalePrice: number; // 全局最近成交价（界面上显示为「上次参考价」）
  /** "上次卖给该客户的价格"，选中商品后按需查询（不再预先把全表拉进内存） */
  lastCustomerPrice: number | null;
  supplierId: string;
  supplyPrice: string;
  /** 多补：在客户需求量（自动补足缺口）之外额外多进的备货量；留空＝不多补 */
  extraQty: string;
  /** 本次使用的现有库存量；留空＝尽量用库存，填 0＝全部现场进货 */
  stockUsed: string;
  /** 行备注（如包装、交货要求） */
  remark: string;
  hasLastSupplier: boolean;
  /**
   * 估价行：开单时只知道售价，进价与货源后补。
   * 这种行不占用库存、不产生自动补货进货单，成本记 0（补单时再写回）。
   */
  estimated: boolean;
}

/** 草稿里存的内容：只是"用户填了什么"，商品/客户的展示信息都会由目录重新渲染出来 */
interface SaleDraft {
  rows: Row[];
  customerId: string;
  customerQuery: string;
  remark: string;
  starred: boolean;
}

const inputCls = `w-full ${inputBase}`;
/** 数字输入：等宽数字 + 右对齐，一列数字才扫得动 */
const inputNumCls = `${inputCls} tabular-nums`;
/** 只读数值：与输入框同高同内边距，保证同行里"能填的"和"只看的"数值基线一致 */
const readOnlyValue = "flex h-9 items-center px-2 tabular-nums";

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
  canSeeCost,
  currentUserId,
  prefill = null,
}: {
  customers: CustomerOption[];
  suppliers: SupplierOption[];
  products: ProductOption[];
  units: UnitOption[];
  categories: CategoryOption[];
  customerGroups: { id: number; name: string }[];
  customerTags: { id: number; name: string }[];
  /** 客户-商品 → 最近成交价（参考展示，不覆盖输入） */
  canCreateCustomer: boolean;
  canCreateProduct: boolean;
  /** 成本可见性（与单据详情页 canSeeCost 同口径：业务员不可见成本/毛利） */
  canSeeCost: boolean;
  /** 当前用户 id：草稿按人存，同一台电脑换人登录不会串 */
  currentUserId: number;
  /** 「改单」带进来的原单内容（原单此时应已作废）：用来预填表单 */
  prefill?: {
    orderId: number;
    orderNo: string;
    /** 原单是否已作废（正常流程里是；没作废就提示一下） */
    voided: boolean;
    customerId: string;
    customerName: string;
    remark: string;
    starred: boolean;
    rows: {
      productId: string;
      productCode: string;
      productQuery: string;
      manufacturer: string;
      unitName: string;
      stockQty: number;
      avgCost: number;
      quantity: string;
      unitPrice: string;
      stockUsed: string;
      supplyPrice: string;
      supplierId: string;
      extraQty: string;
      remark: string;
    }[];
  } | null;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    prefill
      ? prefill.rows.map((r) => ({
          productId: r.productId,
          productLabel: `${r.productCode} ${r.productQuery}`,
          productCode: r.productCode,
          productQuery: r.productQuery,
          manufacturer: r.manufacturer,
          unitName: r.unitName,
          stockQty: r.stockQty,
          avgCost: r.avgCost,
          quantity: r.quantity,
          unitPrice: r.unitPrice,
          lastGlobalSalePrice: 0,
          lastCustomerPrice: null,
          supplierId: r.supplierId,
          supplyPrice: r.supplyPrice,
          extraQty: r.extraQty,
          stockUsed: r.stockUsed,
          remark: r.remark,
          hasLastSupplier: !!r.supplierId,
          estimated: false,
        }))
      : [emptyRow()]
  );
  const [productOptions, setProductOptions] = useState<ProductOption[]>(products);
  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>(customers);
  // 服务端搜索结果（商品/客户目录可能上千，首屏只带"最近往来"，输入时按需搜索）
  const [remoteProducts, setRemoteProducts] = useState<OrderProductOption[]>([]);
  const [remoteCustomers, setRemoteCustomers] = useState<OrderCustomerOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState(prefill?.customerId ?? "");
  const [customerQuery, setCustomerQuery] = useState(prefill?.customerName ?? "");
  /** 单据备注：原先是不受控输入，做草稿必须能取到值，改成受控 */
  const [saleRemark, setSaleRemark] = useState(prefill?.remark ?? "");
  /** 星标：开单时就标记"重要单据"，随表单提交 */
  const [starred, setStarred] = useState(prefill?.starred ?? false);
  const [showCandidates, setShowCandidates] = useState(false);

  const selectedCustomer = customerOptions.find((c) => String(c.id) === customerId);
  const candidates = (() => {
    // 框里显示的就是当前选中的客户名时，不算搜索词——否则一打开就只剩他一个人
    const raw = customerQuery.trim();
    const kw = raw === (selectedCustomer?.name ?? "") ? "" : raw;
    const local = kw
      ? customerOptions.filter((c) => matchesSearch(c.name, c.py ?? "", kw) || c.id === Number(customerId))
      : customerOptions;
    const seen = new Set(local.map((c) => c.id));
    const remote = kw ? remoteCustomers.filter((c) => !seen.has(c.id)) : [];
    return [...local, ...remote].slice(0, 30);
  })();

  // 输入即搜（防抖 250ms）：目录可能上千，只把"最近往来"放在首屏，其余按需向服务端要。
  // 所有 setState 都在定时器/异步回调里执行（不在 effect 体内同步 setState，避免级联渲染）。
  const productQueryForSearch = rows.map((r) => r.productQuery.trim()).join("\u0000");
  useEffect(() => {
    const kw = rows
      .map((r) => r.productQuery.trim())
      .filter(Boolean)
      .join(" ")
      .trim();
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      if (!kw) {
        setRemoteProducts([]);
        return;
      }
      setSearching(true);
      searchProductsForOrder(kw)
        .then((list) => {
          if (!cancelled) {
            setRemoteProducts(list);
            setSearchError(null);
          }
        })
        .catch((e: unknown) => {
          if (!cancelled) {
            setRemoteProducts([]);
            setSearchError(e instanceof Error ? e.message : "搜索失败");
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productQueryForSearch]);

  useEffect(() => {
    const kw = customerQuery.trim();
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      if (!kw) {
        setRemoteCustomers([]);
        return;
      }
      searchCustomersForOrder(kw)
        .then((list) => {
          if (!cancelled) setRemoteCustomers(list);
        })
        .catch(() => {
          if (!cancelled) setRemoteCustomers([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [customerQuery]);

  function onCustomerQueryChange(value: string) {
    setCustomerQuery(value);
    // 输入与当前选中名不一致即视为重新搜索，清空选中
    if (value !== selectedCustomer?.name) setCustomerId("");
    setShowCandidates(true);
    setCandActive(-1); // 换了关键词，原来的键盘高亮不作数
  }

  function chooseCustomer(c: CustomerOption) {
    setCustomerId(String(c.id));
    setCustomerQuery(c.name);
    setShowCandidates(false);
  }
  const [showCreateProduct, setShowCreateProduct] = useState(false);
  const [newProduct, setNewProduct] = useState({
    name: "",
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
    // 厂家候选同样支持首字母：打 yddl 找到「远东电缆」
    return kw ? suppliers.filter((s) => matchesSearch(s.name, s.py ?? "", kw)).slice(0, 30) : [];
  })();
  const [productPending, startProductTransition] = useTransition();
  const [showCreateCustomer, setShowCreateCustomer] = useState(false);
  const [createCustomerMsg, setCreateCustomerMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [createPending, startCreateTransition] = useTransition();
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createSaleOrderAction,
    null
  );

  const [newCustomer, setNewCustomer] = useState({ name: "", phone: "" });
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
      setNewCustomer({ name: "", phone: "" });
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

  /** 打开"新建客户"表单并把名字预填好（候选面板里的「＋ 新建客户：「xx」」与右上角按钮共用） */
  function startCreateCustomer(name: string) {
    setNewCustomer({ name, phone: "" });
    setNewCustomerGroupId("");
    setNewCustomerTagIds([]);
    setCreateCustomerMsg(null);
    setShowCreateCustomer(true);
    setShowCandidates(false);
    setQuickOrgMsg(null);
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

      avgCost: 0,
      lastCustomerPrice: null,
      quantity: "",
      unitPrice: "",
      lastGlobalSalePrice: 0,
      supplierId: "",
      supplyPrice: "",
      extraQty: "",

      stockUsed: "",

      remark: "",
      hasLastSupplier: false,
      estimated: false,
    };
  }

  // 商品候选弹层（fixed 定位，避免被表格 overflow 裁剪）
  const [productPanel, setProductPanel] = useState<{ index: number; top: number; left: number; width: number } | null>(null);
  /** 搜索面板的键盘高亮：候选项多时用 ↑/↓ 选、回车确认（-1 = 没高亮） */
  const [panelActive, setPanelActive] = useState(-1);
  const [candActive, setCandActive] = useState(-1);

  /** 候选 = 本地（已加载的"最近往来"）命中 + 服务端搜索结果，按 id 去重 */
  function searchProducts(row: Row | undefined): ProductOption[] {
    if (!row) return [];
    const kws = [row.productCode.trim(), row.productQuery.trim()]
      .map((v) => v.toLowerCase())
      .filter(Boolean);
    if (kws.length === 0) return [];
    const local = productOptions.filter((p) => {
      // 拼音首字母串一并纳入匹配：打 dxtx 命中「单芯铜线」、yddl 命中「远东电缆」
      const hay = [p.code, p.name, p.manufacturer, p.py ?? ""].join(" ").toLowerCase();
      return kws.every((kw) => hay.includes(kw));
    });
    const seen = new Set(local.map((p) => p.id));
    const remote = remoteProducts
      .filter((p) => !seen.has(p.id))
      .map((p) => ({
        ...p,
        label: `${p.code} ${p.name}`,
        lastSupplierName: "",
      }));
    return [...local, ...remote].slice(0, 30);
  }

  function openProductPanel(e: React.FocusEvent<HTMLInputElement>, index: number) {
    const rect = e.currentTarget.getBoundingClientRect();
    setProductPanel({ index, top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 320) });
    setPanelActive(-1);
  }

  function onProductInputChange(index: number, field: "code" | "name", value: string) {
    setPanelActive(-1); // 换了关键词，原来的键盘高亮不作数
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

            avgCost: 0,
      lastCustomerPrice: null,
            unitPrice: "",
            supplierId: "",
            supplyPrice: "",
            extraQty: "",

            stockUsed: "",

            remark: "",
            hasLastSupplier: false,
            estimated: false,
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
              avgCost: p.avgCost,
              unitPrice: String(p.refSalePrice),
              lastGlobalSalePrice: p.refSalePrice,
              supplierId: p.lastSupplierId != null ? String(p.lastSupplierId) : "",
              supplyPrice: String(p.lastSupplyPrice),
              extraQty: "",

              stockUsed: "",

              remark: "",
              hasLastSupplier: p.lastSupplierId != null,
            estimated: false,
            }
          : row
      )
    );
    setProductPanel(null);
    // 选中后再按需取"最近成交价 / 上次卖给该客户的价格"，避免预先把全部历史明细拉进内存
    productHintsForOrder(p.id, customerId ? Number(customerId) : null)
      .then((hints) => {
        setRows((prev) =>
          prev.map((row, i) =>
            i === index
              ? {
                  ...row,
                  lastGlobalSalePrice: hints.lastSalePrice || row.lastGlobalSalePrice,
                  lastCustomerPrice: hints.lastCustomerPrice,
                }
              : row
          )
        );
      })
      .catch(() => {
        /* 取不到就保持原样，不影响开单 */
      });
  }

  /** 本次使用的现有库存量：留空＝尽量用库存（上限为库存与需求量），可改小甚至填 0（全部现场进货）。 */
  function usedStock(row: Row): number {
    if (row.estimated) return 0; // 估价行不占库存
    const qty = Number(row.quantity);
    if (!Number.isFinite(qty) || qty <= 0) return 0;
    const cap = Math.max(Math.min(row.stockQty, qty), 0);
    if (row.stockUsed.trim() === "") return cap;
    const v = Number(row.stockUsed);
    return Number.isFinite(v) ? Math.max(0, Math.min(v, cap)) : cap;
  }

  /** 需现场进货的数量 = 客户需求量 − 使用库存量（界面只读展示）。 */
  function needPurchase(row: Row): number {
    if (row.estimated) return 0; // 估价行先不进货，等问到价格再补单
    const qty = Number(row.quantity);
    if (!Number.isFinite(qty) || qty <= 0) return 0;
    return Math.max(qty - usedStock(row), 0);
  }

  /** 多补量：在客户需求之外额外多进的备货（负数/空视为 0）。 */
  function extraRestock(row: Row): number {
    const v = Number(row.extraQty);
    return Number.isFinite(v) && v > 0 ? v : 0;
  }

  /** 本次补货总量 = 需现场进货 + 多补备货。 */
  function restockTotal(row: Row): number {
    return needPurchase(row) + extraRestock(row);
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
      setProductMsg({ error: "请选择或新建厂家" });
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
            manufacturer: result.manufacturer,
        unitName: result.unitName,
        stockQty: 0,

        avgCost: 0,
        refSalePrice: result.refSalePrice,
        lastSupplierId: mfrSupplierId,
        lastSupplyPrice: result.refPurchasePrice,
      };
      setProductOptions((prev) => (prev.some((p) => p.id === result.id) ? prev : [...prev, opt]));
      // 替换当前的空行（不存在空行才追加），选中新商品（库存 0 → 走缺货补货流程）
      setRows((prev) => {
        const newRow = {
          productId: String(result.id),
          productLabel: `${result.code} ${result.name}`,
          productCode: result.code,
          productQuery: result.name,
          manufacturer: result.manufacturer,
          unitName: result.unitName,
          stockQty: 0,

          avgCost: 0,
      lastCustomerPrice: null,
          quantity: "",
          unitPrice: String(result.refSalePrice),
          lastGlobalSalePrice: result.refSalePrice,
          supplierId: "",
          supplyPrice: String(result.refPurchasePrice),
          extraQty: "",

          stockUsed: "",

          remark: "",
          hasLastSupplier: false,
        estimated: false,
        };
        // 未选中的行视为空行（即便输入过搜索词），替换为新商品行
        const emptyIdx = prev.findIndex((r) => !r.productId);
        if (emptyIdx >= 0) {
          return prev.map((r, idx) => (idx === emptyIdx ? newRow : r));
        }
        return [...prev, newRow];
      });
      setShowCreateProduct(false);
      setNewProduct({ name: "", manufacturer: "", categoryId: "", unitId: "", refSalePrice: "", refPurchasePrice: "", minStock: "1" });
      setMfrQuery("");
      setProductMsg({ ok: `商品「${result.name}」已创建（${result.code}），已加入商品行` });
      setTimeout(() => setProductMsg(null), 5000);
    });
  }

  // 开单草稿：填到一半切走再回来，内容还在（机制见 lib/form-draft.ts）
  // 从草稿箱点进来会带 ?draft=<id>，指定恢复哪一份；否则恢复最近那份
  const urlDraftId = useSearchParams().get("draft") ?? undefined;
  const draftValue = useMemo(
    () => ({ rows, customerId, customerQuery, remark: saleRemark, starred }),
    [rows, customerId, customerQuery, saleRemark, starred]
  );
  /** 草稿箱列表里显示的摘要（存草稿时一起写进去，列表页不用懂单据结构） */
  const draftSummary = useMemo(
    () => ({
      partner: selectedCustomer?.name ?? customerQuery.trim(),
      lines: rows.filter((r) => !!r.productId || r.productQuery.trim() !== "").length,
      amount: rows.reduce((s, r) => s + lineAmount(r), 0),
      preview: rows
        .map((r) => (r.productLabel || r.productQuery).trim())
        .filter(Boolean)
        .slice(0, 2)
        .join("、"),
    }),
    [rows, selectedCustomer, customerQuery]
  );
  const { restoredAt, savedAt, discard, startNew, clearStored } = useFormDraft<SaleDraft>({
    scope: "sale",
    userId: currentUserId,
    draftId: urlDraftId,
    // 改单来的：表单已被原单内容预填，别让旧草稿盖掉
    skipRestore: !!prefill,
    summary: draftSummary,
    value: draftValue,
    // 选了客户、写了备注、或某行开始填了，才算"有内容"；全空就把草稿删掉
    hasContent:
      !!customerId || saleRemark.trim() !== "" || rows.some((r) => !!r.productId || r.productQuery.trim() !== ""),
    apply: (d) => {
      setRows(Array.isArray(d.rows) && d.rows.length > 0 ? d.rows : [emptyRow()]);
      setCustomerId(typeof d.customerId === "string" ? d.customerId : "");
      setCustomerQuery(typeof d.customerQuery === "string" ? d.customerQuery : "");
      setSaleRemark(typeof d.remark === "string" ? d.remark : "");
      setStarred(!!d.starred);
    },
    onDiscard: () => {
      setRows([emptyRow()]);
      setCustomerId("");
      setCustomerQuery("");
      setSaleRemark("");
      setStarred(false);
    },
  });

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
          <Link href={`/sale-orders/${prefill.orderId}`} className="text-amber-700 underline decoration-dotted underline-offset-2 hover:decoration-solid">
            看原单
          </Link>
        </div>
      )}
      {/* 客户信息（可折叠） */}
      <details open className="rounded-xl border border-gray-200 bg-white">
        <summary className="cursor-pointer rounded-t-xl px-5 py-3 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50">
          客户信息
          <span className="ml-2 text-xs font-normal text-gray-400">
            {selectedCustomer ? selectedCustomer.name : "尚未选择客户"}
          </span>
        </summary>
        <div className="border-t border-gray-100 p-5">
          <div className="flex flex-wrap items-end gap-4">
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
                placeholder="搜索客户…"
                value={customerQuery}
                onChange={(e) => onCustomerQueryChange(e.target.value)}
                onFocus={(e) => {
                  selectAllOnFocus(e);
                  setShowCandidates(true);
                }}
                  onClick={selectAllOnClick}
                  onKeyDown={(e) => {
                    // 与商品搜索同一套：↑/↓ 移动、回车选中、Esc 收起（回车不提交整张单）
                    const total = candidates.length + (canCreateCustomer && customerQuery.trim() ? 1 : 0);
                    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                      if (total === 0) return;
                      e.preventDefault();
                      setShowCandidates(true);
                      setCandActive((cur) => (e.key === "ArrowDown" ? (cur + 1) % total : cur <= 0 ? total - 1 : cur - 1));
                      return;
                    }
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (!showCandidates || candActive < 0) return;
                      const offset = canCreateCustomer && customerQuery.trim() ? 1 : 0;
                      if (offset === 1 && candActive === 0) {
                        startCreateCustomer(customerQuery.trim());
                        setCandActive(-1);
                        return;
                      }
                      const c = candidates[candActive - offset];
                      if (c) chooseCustomer(c);
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setShowCandidates(false);
                      setCandActive(-1);
                    }
                  }}
                  onBlur={() => setShowCandidates(false)}
                className={`w-full ${inputCls} pr-32`}
              />
          {customerId && selectedCustomer && (
                <div className="pointer-events-none absolute inset-y-0 right-2 top-1 flex items-center gap-1">
                  {selectedCustomer.groupName && (
                    <span className="whitespace-nowrap rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] leading-none text-blue-700">
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
                    <div className="px-3 py-2 text-xs text-gray-400">
                      {searching ? "搜索中…" : "无匹配客户（也可直接点上方「新建客户」）"}
                    </div>
                  )}
                  {canCreateCustomer && customerQuery.trim() && (
                    /* 搜索里找不到就直接建：点它会把名字带进下面的新建表单（与商品选择器的做法一致） */
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => startCreateCustomer(customerQuery.trim())}
                      className={`block w-full border-b border-gray-100 px-3 py-2 text-left text-sm text-blue-600 ${
                        candActive === 0 ? "bg-blue-50" : "hover:bg-blue-50"
                      }`}
                    >
                      ＋ 新建客户：「{customerQuery.trim()}」
                    </button>
                  )}
                  {candidates.map((c, i) => {
                    const idx = i + (canCreateCustomer && customerQuery.trim() ? 1 : 0);
                    return (
                    <button
                      type="button"
                      key={c.id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => chooseCustomer(c)}
                      ref={(el) => {
                        if (el && candActive === idx) el.scrollIntoView({ block: "nearest" });
                      }}
                      className={`block w-full px-3 py-2 text-left text-sm text-gray-900 ${
                        candActive === idx ? "bg-blue-50" : "hover:bg-blue-50"
                      }`}
                    >
                      <span className="font-medium">{c.name}</span>
                      {c.groupName && (
                        <span className={`ml-2 ${badgeInfo}`}>{c.groupName}</span>
                      )}
                      {c.tagNames.map((t) => (
                        <span key={t} className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{t}</span>
                      ))}
                    </button>
                    );
                  })}
                </div>
              )}
            </div>
            {canCreateCustomer && (
              <button
                type="button"
                onClick={() => {
                  if (showCreateCustomer) {
                    setShowCreateCustomer(false);
                    setCreateCustomerMsg(null);
                    return;
                  }
                  // 已经输入了名字就带过去，省得再打一遍
                  startCreateCustomer(customerQuery.trim());
                }}
                className={`shrink-0 ${btnSmallPrimary}`}
              >
                {showCreateCustomer ? "取消" : "+ 新建客户"}
              </button>
            )}
          </div>

          {/* 辅助/告警行：常驻占位，避免提示出现时把下方内容顶下去、也避免把按钮挤歪 */}
          <p className="mt-1 min-h-4 text-xs">
            {customerQuery.trim() && !customerId ? (
              <span className="text-amber-600">已输入但未选中客户：请从弹出的候选中点选</span>
            ) : (
              <span className="text-gray-400">输入客户名后，从弹出的候选中点选</span>
            )}
          </p>

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
                  maxLength={30}
                  placeholder="电话"
                  value={newCustomer.phone}
                  onChange={(e) => setNewCustomer((p) => ({ ...p, phone: e.target.value }))}
                  className="block w-full rounded-md border border-blue-200 px-2 py-1.5 text-sm text-gray-900"
                />
              </div>

              {/* 组织选择（可搜索）+ 快捷新建 */}
              <div className="flex items-center gap-2">
                <SearchSelect
                  key={`qc-grp-${newCustomerGroupId}-${quickGroupOptions.length}`}
                  name="newCustomerGroupId"
                  options={quickGroupOptions.map((g) => ({ value: String(g.id), label: g.name, py: initials(g.name) }))}
                  defaultValue={newCustomerGroupId}
                  noneLabel="所属组织（可选）"
                  placeholder="输入关键词搜索组织…"
                  emptyHint="无匹配组织，可点右侧「+ 组织」新建"
                  className="flex-1"
                  onChange={setNewCustomerGroupId}
                />
                <button
                  type="button"
                  onClick={() => { setShowQuickGroup((v) => !v); setShowQuickTag(false); setQuickOrgName(""); }}
                  className={`shrink-0 ${btnSmallPrimary}`}
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
                    className={`shrink-0 ${btnSmallSolid}`}>
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
                      className={btnSmallSolid}>
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
                  className={btnSmallSolid}
                >
                  {createPending ? "创建中…" : "创建并选用"}
                </button>
                <FormStateAlert state={createCustomerMsg} compact className="flex-1" />
              </div>
            </div>
          )}
        </div>
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
                <label className="block text-xs font-medium text-gray-600">商品名称 *</label>
                <input
                  type="text"
                  maxLength={100}
                  placeholder="写全名称，如：BV 2.5平方 单芯铜线"
                  value={newProduct.name}
                  onChange={(e) => setNewProduct((p) => ({ ...p, name: e.target.value }))}
                  className={`${inputBase} mt-1 w-full text-gray-900`}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600">厂家 *</label>
                <div className="relative mt-1">
                  <input
                    type="text"
                    autoComplete="off"
                    placeholder="缺货时自动向其补货，可当场新建"
                    value={mfrQuery}
                    onChange={(e) => { setMfrQuery(e.target.value); setMfrOpen(true); }}
                    onFocus={() => setMfrOpen(true)}
                    onBlur={() => setTimeout(() => setMfrOpen(false), 150)}
                    className={`${inputBase} w-full  text-gray-900`}
                  />
                  {mfrOpen && mfrQuery.trim() && (
                    <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
                      {mfrHits.length === 0 && <div className="px-3 py-2 text-xs text-gray-400">无匹配厂家</div>}
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
                        ＋ 新建厂家：「{mfrQuery.trim()}」
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600">分类</label>
                <div className="mt-1 flex items-center gap-1">
                  <SearchSelect
                    key={`np-cat-${newProduct.categoryId}-${categoryOptions.length}`}
                    name="quickCategory"
                    options={categoryOptions.map((c) => ({ value: String(c.id), label: c.name, py: initials(c.name) }))}
                    defaultValue={newProduct.categoryId}
                    noneLabel="未分类"
                    placeholder="分类（可搜索）"
                    className="flex-1"
                    onChange={(v) => setNewProduct((p) => ({ ...p, categoryId: v }))}
                  />
                  <button
                    type="button"
                    onClick={() => { setShowQuickCategory((v) => !v); setShowQuickUnit(false); setQuickOptionName(""); }}
                    className={`shrink-0 ${btnSmallPrimary}`}
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
                      className={`shrink-0 ${btnSmallSolid}`}>
                      {productPending ? "…" : "创建"}
                    </button>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600">单位 *</label>
                <div className="mt-1 flex items-center gap-1">
                  <SearchSelect
                    key={`np-unit-${newProduct.unitId}-${unitOptions.length}`}
                    name="quickUnit"
                    options={unitOptions.map((u) => ({ value: String(u.id), label: u.name, py: initials(u.name) }))}
                    defaultValue={newProduct.unitId}
                    noneLabel="请选择"
                    placeholder="单位（可搜索）"
                    className="flex-1"
                    onChange={(v) => setNewProduct((p) => ({ ...p, unitId: v }))}
                  />
                  <button
                    type="button"
                    onClick={() => { setShowQuickUnit((v) => !v); setShowQuickCategory(false); setQuickOptionName(""); }}
                    className={`shrink-0 ${btnSmallPrimary}`}
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
                      className={`shrink-0 ${btnSmallSolid}`}>
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
                  className={`${inputBase} mt-1 w-full text-gray-900`}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600">库存预警线</label>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  placeholder="留空按 1 计"
                  value={newProduct.minStock}
                  onChange={(e) => setNewProduct((p) => ({ ...p, minStock: e.target.value }))}
                  className={`${inputBase} mt-1 w-full text-gray-900`}
                />
              </div>
              <div className="flex items-end gap-2">
                <button
                  type="button"
                  onClick={onCreateProduct}
                  disabled={productPending}
                  className={btnSmallSolid}
                >
                  {productPending ? "创建中…" : "创建商品并加行"}
                </button>
              </div>
              <FormStateAlert state={productMsg} compact className="col-span-full" />
            </div>

        </div>
      )}
      {/* 单据备注（作用于整张单据，放在商品明细上方） */}
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="sale-remark" className="shrink-0 text-sm text-gray-600">
          单据备注
        </label>
        <input
          id="sale-remark"
          name="remark"
          type="text"
          maxLength={200}
          value={saleRemark}
          onChange={(e) => setSaleRemark(e.target.value)}
          placeholder="选填，如交货方式、包装要求（作用于整张单据）"
          className={`${inputBase} max-w-xl min-w-56 flex-1`}
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

      {/* 商品清单：每行一个商品。整行做成卡片，卡内字段按「成交 / 补货 / 结算」三组排成一行 */}
      <div className="space-y-3">
        {rows.map((row, i) => {
          const used = usedStock(row);
          // 两个价格提示都要能「点一下填入售价」：取成 const，闭包里 TS 的窄化才成立
          const lastCustomerPrice = row.lastCustomerPrice;
          const globalRefPrice = row.lastGlobalSalePrice;
          const need = needPurchase(row);
          const extra = extraRestock(row);
          const qtyNum = Number(row.quantity) || 0;
          const stockCap = Math.min(row.stockQty, qtyNum);
          /** 商品自己没库存：用库存这一格填什么都不生效，直接禁用并说明原因 */
          const noStock = row.stockQty <= 0;
          /** 填得比可用的还多：实际按上限算，得让用户看见，不能静默改数 */
          const overCap = !noStock && row.stockUsed.trim() !== "" && Number(row.stockUsed) > stockCap;
          // 售价下方的"点一下填入"提示：优先该客户上次成交价，其次全局参考价
          const priceHint =
            customerId && lastCustomerPrice != null ? (
              <button
                type="button"
                onClick={() =>
                  setRows((prev) =>
                    prev.map((r, j) => (j === i ? { ...r, unitPrice: lastCustomerPrice.toFixed(2) } : r))
                  )
                }
                title={`点一下填入 ${selectedCustomer?.name ?? "该客户"} 上次成交价 ¥${lastCustomerPrice.toFixed(2)}`}
                className="block w-full cursor-pointer truncate text-left text-blue-600 underline decoration-dotted underline-offset-2 hover:decoration-solid"
              >
                上次 ¥{lastCustomerPrice.toFixed(2)}
              </button>
            ) : globalRefPrice > 0 ? (
              <button
                type="button"
                onClick={() =>
                  setRows((prev) =>
                    prev.map((r, j) => (j === i ? { ...r, unitPrice: globalRefPrice.toFixed(2) } : r))
                  )
                }
                title={`点一下填入全局最近成交价 ¥${globalRefPrice.toFixed(2)}`}
                className="block w-full cursor-pointer truncate text-left text-gray-500 underline decoration-dotted underline-offset-2 hover:text-blue-600 hover:decoration-solid"
              >
                参考价 ¥{globalRefPrice.toFixed(2)}
              </button>
            ) : undefined;
          return (
            <div
              key={i}
              className="rounded-xl border border-gray-200 bg-gray-50/70 p-3 transition focus-within:border-blue-300 hover:border-gray-300"
            >
              {/* 商品 */}
              <div className="flex items-center gap-2">
                <input
                  name={`item_${i}_productQuery`}
                  type="text"
                  autoComplete="off"
                  placeholder="搜索商品：名称 / 型号 / 厂家 / 编码"
                  value={row.productQuery}
                  onChange={(e) => onProductInputChange(i, "name", e.target.value)}
                  onFocus={(e) => {
                    selectAllOnFocus(e);
                    openProductPanel(e, i);
                  }}
                  onClick={selectAllOnClick}
                  onKeyDown={(e) => {
                    // 开单页里回车不该提交整张单；↑/↓ 在候选里移动，回车选中
                    const hits = searchProducts(row);
                    const total = hits.length + (canCreateProduct && row.productQuery.trim() ? 1 : 0);
                    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                      if (total === 0) return;
                      e.preventDefault();
                      setPanelActive((cur) => (e.key === "ArrowDown" ? (cur + 1) % total : cur <= 0 ? total - 1 : cur - 1));
                      return;
                    }
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (panelActive < 0) return;
                      if (canCreateProduct && row.productQuery.trim() && panelActive === 0) {
                        setNewProduct((prev) => ({ ...prev, name: (row.productCode.trim() + " " + row.productQuery.trim()).trim() }));
                        setShowCreateProduct(true);
                        setProductPanel(null);
                        setPanelActive(-1);
                        return;
                      }
                      const p = hits[panelActive - (canCreateProduct && row.productQuery.trim() ? 1 : 0)];
                      if (p) chooseProduct(i, p);
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setProductPanel(null);
                      setPanelActive(-1);
                    }
                  }}
                  onBlur={() => setProductPanel(null)}
                  className={`${inputCls} min-w-0 flex-1`}
                />
                {row.productId && (
                  <span
                    className={`shrink-0 ${row.manufacturer ? tagInfo : tagPending}`}
                    title="厂家：缺货时自动向该厂家补货"
                  >
                    {row.manufacturer || "未填厂家"}
                  </span>
                )}
                {row.productCode && (
                  <span className="shrink-0 text-xs text-gray-400">{row.productCode}</span>
                )}
                {/* 商品 ID 随表单提交（重新设计布局时漏掉过，务必保留） */}
                <input type="hidden" name={`item_${i}_productId`} value={row.productId} />
                {/* 估价待补：这一行只记售价，进价与货源后补 */}
                <input type="hidden" name={`item_${i}_estimated`} value={row.estimated ? "1" : ""} />
                <button
                  type="button"
                  onClick={() =>
                    setRows((prev) => {
                      const next = prev.filter((_, j) => j !== i);
                      return next.length > 0 ? next : [emptyRow()];
                    })
                  }
                  className="shrink-0 rounded px-1.5 py-1 text-xs text-gray-400 transition hover:bg-red-50 hover:text-red-600"
                  title="删除本行"
                >
                  删除
                </button>
              </div>

              {row.productId ? (
                <>
                  {/* 三组字段排成一行：窗口窄就横向滑动看后面的（不折行）。
                      每列都是「标签 / 值 / 提示」三层，提示层恒占一行高度，
                      所以某列有没有提示都不会把相邻列的数值顶得参差不齐。 */}
                  <div className="scroll-thin mt-3 flex items-start gap-x-3 overflow-x-auto pb-1.5">
                    <RowField label="估价" className="w-[3.5rem]">
                      <button
                        type="button"
                        onClick={() =>
                          setRows((prev) =>
                            prev.map((r, j) => (j === i ? { ...r, estimated: !r.estimated } : r))
                          )
                        }
                        aria-pressed={row.estimated}
                        title={
                          row.estimated
                            ? "估价待补：只记售价，不占库存、不自动进货；到「估价待补单」里补进价与货源"
                            : "标为估价待补（价格/货源还没定，先把单开出来）"
                        }
                        className={`h-9 w-full rounded-md border px-1 text-xs transition ${
                          row.estimated
                            ? "border-amber-300 bg-amber-50 font-medium text-amber-700"
                            : "border-gray-300 bg-white text-gray-400 hover:border-amber-300 hover:text-amber-600"
                        }`}
                      >
                        {row.estimated ? "估价" : "—"}
                      </button>
                    </RowField>
                    <RowField label="数量" required className="w-[6.5rem]">
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
                    <RowField label="单位" className="w-[4.5rem]">
                      <span className={`${readOnlyValue} text-sm text-gray-700`}>{row.unitName || "—"}</span>
                    </RowField>
                    <RowField
                      label="库存"
                      className="w-[7rem]"
                      hint={canSeeCost && row.avgCost > 0 ? `均价 ¥${row.avgCost.toFixed(2)}` : undefined}
                    >
                      <span className={`${readOnlyValue} text-sm text-gray-700`}>
                        {row.stockQty.toFixed(3)}
                      </span>
                    </RowField>

                    <RowDivider />

                    <RowField
                      label="用库存"
                      className="w-[7rem]"
                      hint={
                        row.estimated
                          ? "估价行不占库存，成本后补"
                          : noStock
                            ? "无库存，只能现场进货"
                            : qtyNum <= 0
                              ? "先填数量"
                              : overCap
                                ? `超上限，按 ${stockCap.toFixed(3)} 计`
                                : used > 0
                                  ? `用 ${used.toFixed(3)}`
                                  : "全部现场进货"
                      }
                      hintClass={noStock || overCap ? "font-medium text-amber-600" : "text-gray-400"}
                      hintTitle="使用现有库存的数量（成本按原移动加权成本，不可改价）；填 0 表示全部现场进货"
                    >
                      <input
                        name={`item_${i}_stockUsed`}
                        type="number"
                        min="0"
                        step="0.001"
                        inputMode="decimal"
                        placeholder={noStock || row.estimated ? "—" : stockCap.toFixed(3)}
                        disabled={noStock || row.estimated}
                        // 零库存时连框里的旧值一起清掉（例如恢复的草稿里留着上次填的数），
                        // 免得出现"灰掉的框里还写着 5"这种自相矛盾的画面
                        value={noStock ? "" : row.stockUsed}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v.startsWith("-")) return; // 不允许负数
                          setRows((prev) => prev.map((r, j) => (j === i ? { ...r, stockUsed: v } : r)));
                        }}
                        // 失焦时按上限收敛：框里别留着一个没生效的数字
                        onBlur={() => {
                          if (!overCap) return;
                          setRows((prev) =>
                            prev.map((r, j) => (j === i ? { ...r, stockUsed: stockCap.toFixed(3) } : r))
                          );
                        }}
                        title={
                          noStock
                            ? "该商品当前没有库存，只能现场进货（用库存不可填）"
                            : "使用现有库存的数量（成本按原移动加权成本，不可改价）；填 0 表示全部现场进货"
                        }
                        className={`${inputNumCls} disabled:bg-gray-100 disabled:text-gray-400`}
                      />
                    </RowField>
                    <RowField
                      label="需进货"
                      className="w-[5.5rem]"
                      hint={need > 0 && !row.manufacturer ? "商品未填厂家" : undefined}
                      hintClass="font-medium text-red-500"
                    >
                      <span
                        className={`${readOnlyValue} text-sm ${
                          need > 0 ? "font-medium text-amber-600" : "text-gray-400"
                        }`}
                      >
                        {row.estimated ? "待补" : need.toFixed(3)}
                      </span>
                    </RowField>
                    <RowField label="进价" className="w-[6.5rem]">
                      <input
                        name={`item_${i}_supplyPrice`}
                        type="number"
                        min="0"
                        step="0.01"
                        required={need > 0}
                        disabled={need <= 0}
                        value={row.supplyPrice}
                        onChange={(e) =>
                          setRows((prev) => prev.map((r, j) => (j === i ? { ...r, supplyPrice: e.target.value } : r)))
                        }
                        placeholder={need > 0 ? "" : "—"}
                        title="现场进货价（仅需进货部分适用）"
                        className={`${inputNumCls} disabled:bg-gray-100 disabled:text-gray-400`}
                      />
                    </RowField>
                    <RowField
                      label="多补"
                      className="w-[6rem]"
                      hint={extra > 0 ? `补货共 ${restockTotal(row).toFixed(3)}` : undefined}
                      hintClass="font-medium text-blue-600"
                    >
                      <input
                        name={`item_${i}_extraQty`}
                        type="number"
                        min="0"
                        step="0.001"
                        inputMode="decimal"
                        placeholder="0"
                        disabled={need <= 0 && extra <= 0}
                        value={row.extraQty}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v.startsWith("-")) return; // 不允许负数
                          setRows((prev) => prev.map((r, j) => (j === i ? { ...r, extraQty: v } : r)));
                        }}
                        title="多补：客户需求之外额外多进备货（不计入该客户成本）"
                        className={`${inputNumCls} disabled:bg-gray-100 disabled:text-gray-400`}
                      />
                    </RowField>

                    <RowDivider />

                    {/* 售价放最后：先把数量、库存、补货都定下来，最后定价——
                        紧跟着的"金额"就是它的结果 */}
                    <RowField label="售价" required className="w-[8rem]" hint={priceHint}>
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
                    <RowField label="金额" className="w-[7rem]">
                      <span className={`${readOnlyValue} text-base font-semibold text-gray-900`}>
                        ¥{lineAmount(row).toFixed(2)}
                      </span>
                    </RowField>
                  </div>

                  {/* 行备注 */}
                  <div className="mt-2 flex items-center gap-2">
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
                <p className="mt-2 text-xs text-gray-400">选择商品后填写数量、售价、补货方式与备注</p>
              )}
            </div>
          );
        })}
      </div>

      {/* 底部操作与合计（去边框，融入区域） */}
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
            <button
              type="button"
              onClick={() => {
                setShowCreateProduct((v) => !v);
                setProductMsg(null);
              }}
              className={btnSmallPrimary}
            >
              {showCreateProduct ? "收起" : "+ 新建商品"}
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

      {productPanel && (() => {
        const row = rows[productPanel.index];
        const hits = searchProducts(row);
        /** 置顶的「＋ 新建商品」也参与键盘选择，占第 0 位 */
        const hasCreate = !!(canCreateProduct && row && row.productQuery.trim());
        return (
          <div
            style={{ position: "fixed", top: productPanel.top, left: productPanel.left, width: productPanel.width }}
            className="z-50 max-h-64 overflow-auto rounded-md border border-gray-200 bg-white shadow-lg"
          >
            {hits.length === 0 && (
              <div className="px-3 py-2 text-xs text-gray-400">
                {searching ? "搜索中…" : searchError ? `搜索失败：${searchError}` : "无匹配商品（试试厂家、型号、名称、编码）"}
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
                className={`block w-full border-t border-gray-100 px-3 py-2 text-left text-sm text-blue-600 ${
                  panelActive === 0 ? "bg-blue-50" : "hover:bg-blue-50"
                }`}
              >
                ＋ 新建商品：「{row.productQuery.trim()}」
              </button>
            )}
            {hits.map((p, i) => (
              <button
                type="button"
                key={p.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => chooseProduct(productPanel.index, p)}
                ref={(el) => {
                  if (el && panelActive === i + (hasCreate ? 1 : 0)) el.scrollIntoView({ block: "nearest" });
                }}
                className={`block w-full px-3 py-2 text-left text-sm text-gray-900 ${
                  panelActive === i + (hasCreate ? 1 : 0) ? "bg-blue-50" : "hover:bg-blue-50"
                }`}
              >
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">
                    {p.code} {p.name}
                  </span>
                  <span
                    className={p.manufacturer ? tagInfo : tagPending}
                  >
                    {p.manufacturer || "未填厂家"}
                  </span>
                  <span className="text-xs text-gray-500">
                    库存 {p.stockQty.toFixed(3)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        );
      })()}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || !customerId}
          title={!customerId ? "请先选择客户" : undefined}
          className={btnPrimary}
        >
          {pending ? "提交中…" : "提交售卖单"}
        </button>
        {!customerId && (
          <span className="text-sm text-amber-600">请先在上方选择客户，再提交单据</span>
        )}
        <FormStateAlert state={state} />
      </div>
    </form>
  );
}


/**
 * 商品行的字段列：固定宽度的「标签 / 值 / 提示」三层。
 *
 * 提示层恒占一行高度（没有提示也留空）——之前整行数值对不齐就是这里：
 * 有的列把"均价"塞进数值同一行、有的列提示折成三行，相邻列的数值就被顶歪了。
 */
function RowField({
  label,
  required,
  hint,
  hintTitle,
  hintClass = "text-gray-400",
  className = "",
  children,
}: {
  label: string;
  required?: boolean;
  /** 值下方的一行小字（如均价、上次价）；不传也占位，保证各列高度一致 */
  hint?: React.ReactNode;
  hintTitle?: string;
  hintClass?: string;
  /** 列宽，如 w-[7rem] */
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div data-field={label} className={`shrink-0 ${className}`}>
      <span className="block truncate text-[11px] leading-4 text-gray-500">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      <div className="mt-1">{children}</div>
      <div className={`mt-1 h-4 truncate text-[11px] leading-4 ${hintClass}`} title={hintTitle}>
        {hint}
      </div>
    </div>
  );
}

/** 字段分组之间的竖线：高度跟着整行自适应 */
function RowDivider() {
  return <div className="mx-1 w-px shrink-0 self-stretch bg-gray-200" />;
}
