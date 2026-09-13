"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { btnPrimary, btnSecondary, selectCls } from "@/lib/ui";
import { rmbUpper } from "@/lib/rmb";
import type { PrintModeKey, PrintTemplateConfig, PrintTemplateDTO } from "@/lib/print-template";
import {
  deletePrintTemplateAction,
  savePrintTemplateAction,
  setDefaultPrintTemplateAction,
} from "./template-actions";

/**
 * 销售单打印（可编辑预览）。
 *
 * 版式对齐公司原纸质三联单：
 *   抬头（公司名 + 销售单）
 *   录单日期 / 单据编号
 *   购买单位 / 经手人 / 制单人 / 送货地址（送货地址是比原纸质单多出来的一栏）
 *   明细表：商品编号 商品全名 单位 数量 单价 金额（另可开启 序号 / 备注 列）
 *   总计 + 大写
 *   收款账户 / 收款金额 / 优惠金额
 *   联次标识（第一联存根 / 第二联结账 / 第三联客户）
 *   页脚：地址 / 电话 / 客户签收
 *
 * 打印联次支持三种：三联同页（配复写纸或打印后裁切）、每联一页、只打一联。
 * 打印稿上的修改只作用于本次打印，不回写订单（页面上有明确提示）。
 */

/** 抬头公司名与页脚联系方式：要长期改就改这里（打印预览里也可临时改） */
const DEFAULT_COMPANY = "重庆鑫玮川物资有限公司";
const DEFAULT_FOOTER_ADDRESS = "";
const DEFAULT_FOOTER_PHONE = "";

/** 公司抬头（公司名/地址/电话）对本店是固定的：填一次存本地，之后每次打印自动带上 */
const LETTERHEAD_STORAGE_KEY = "weichuan.print.letterhead";

type Letterhead = { company: string; address: string; phone: string };

const LETTERHEAD_DEFAULTS: Letterhead = {
  company: DEFAULT_COMPANY,
  address: DEFAULT_FOOTER_ADDRESS,
  phone: DEFAULT_FOOTER_PHONE,
};

const letterheadListeners = new Set<() => void>();
/** useSyncExternalStore 要求同一份数据返回同一个引用，所以按原始字符串缓存解析结果 */
let letterheadCache: { raw: string | null; value: Letterhead } | null = null;

function readLetterheadRaw(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LETTERHEAD_STORAGE_KEY);
  } catch {
    return null; // 隐私模式等读不到，就当没存过，仍可当场填写
  }
}

function readLetterhead(): Letterhead {
  const raw = readLetterheadRaw();
  if (letterheadCache && letterheadCache.raw === raw) return letterheadCache.value;
  let value = LETTERHEAD_DEFAULTS;
  if (raw) {
    try {
      const saved = JSON.parse(raw) as Partial<Letterhead>;
      value = {
        company: saved.company || LETTERHEAD_DEFAULTS.company,
        address: saved.address ?? "",
        phone: saved.phone ?? "",
      };
    } catch {
      value = LETTERHEAD_DEFAULTS;
    }
  }
  letterheadCache = { raw, value };
  return value;
}

function writeLetterhead(patch: Partial<Letterhead>) {
  const value = { ...readLetterhead(), ...patch };
  const raw = JSON.stringify(value);
  try {
    window.localStorage.setItem(LETTERHEAD_STORAGE_KEY, raw);
  } catch {
    // 存不进就算了，不影响本次打印
  }
  letterheadCache = { raw, value };
  letterheadListeners.forEach((notify) => notify());
}

function subscribeLetterhead(notify: () => void) {
  letterheadListeners.add(notify);
  return () => {
    letterheadListeners.delete(notify);
  };
}

const getServerLetterhead = () => LETTERHEAD_DEFAULTS;

export interface PrintOrderData {
  orderNo: string;
  createdAt: string;
  customer: { name: string; phone: string; address: string };
  operatorName: string;
  /** 制单人：当前登录用户 */
  editorName: string;
  /** 已收金额（预填"收款金额"） */
  receivedAmount: number;
  remark: string;
  rows: { code: string; name: string; qty: number; unit: string; price: number; remark: string }[];
}

const ALL_COLS = [
  { key: "idx", label: "序号" },
  { key: "code", label: "商品编号" },
  { key: "name", label: "商品全名" },
  { key: "unit", label: "单位" },
  { key: "qty", label: "数量", right: true },
  { key: "price", label: "单价", right: true },
  { key: "amount", label: "金额", right: true },
  { key: "remark", label: "备注" },
];

/**
 * 打印方式（按"用什么纸"区分，而不是按"打几份"）：
 * - carbon：三联复写纸 + 针式打印机。纸本身有三层，**打一遍**三层就都有字，
 *   所以只出一份单据，联次标识按纸质单的样式并排印一行。
 * - a4-three：普通 A4 纸，一页里打三份（各自带联次标识），打印后裁开。
 * - a4-pages：普通 A4 纸，每联单独一页。
 */
const COPY_LABELS = ["第一联：存根联", "第二联：结账联", "第三联：客户联"] as const;

const PRINT_MODES = [
  { key: "carbon", label: "三联复写纸（打一遍）" },
  { key: "a4-three", label: "A4 三联同页" },
  { key: "a4-pages", label: "A4 每联一页" },
] as const satisfies readonly { key: PrintModeKey; label: string }[];

/**
 * 打印稿里的输入框样式。
 * 注意：不能把 w-full 混进通用样式里——Tailwind 里 w-full 的优先级高于 w-28 这类固定宽度，
 * 会让所有「固定宽度」的输入框被撑满整行（之前抬头几行就是这样错位的）。
 * 所以拆成两个：表格单元格用 inputFill（填满单元格），其它位置用 inputBase + 显式宽度。
 */
const inputBase = "bg-transparent outline-none focus:bg-blue-50 rounded px-1 text-inherit";
const inputFill = `${inputBase} w-full`;

export function PrintEditor({
  data,
  templates,
  canManage,
}: {
  data: PrintOrderData;
  /** 已保存的打印模板（服务端按"默认优先"排好序） */
  templates: PrintTemplateDTO[];
  /** 只有管理员能存/删/设默认；其它角色照样能选模板套用 */
  canManage: boolean;
}) {
  // 抬头三件套存浏览器本地（不落库、不回写订单）：只需填一次
  const letterhead = useSyncExternalStore(
    subscribeLetterhead,
    readLetterhead,
    getServerLetterhead
  );
  const company = letterhead.company;
  const footerAddress = letterhead.address;
  const footerPhone = letterhead.phone;
  const [title, setTitle] = useState("销售单");
  const [orderNo, setOrderNo] = useState(data.orderNo);
  const [orderDate, setOrderDate] = useState(data.createdAt);
  const [buyer, setBuyer] = useState(data.customer.name);
  const [handler, setHandler] = useState(data.operatorName);
  const [maker, setMaker] = useState(data.editorName);
  // 送货地址：默认取客户档案地址（最常见就是送到客户那儿），可当场改写
  const [deliveryAddress, setDeliveryAddress] = useState(data.customer.address);
  const [account, setAccount] = useState("");
  const [received, setReceived] = useState(data.receivedAmount ? data.receivedAmount.toFixed(2) : "");
  const [discount, setDiscount] = useState("0");
  const [rows, setRows] = useState(
    data.rows.map((r) => ({
      code: r.code,
      name: r.name,
      qty: r.qty.toFixed(3),
      unit: r.unit,
      price: r.price.toFixed(2),
      remark: r.remark,
    }))
  );
  // 默认按纸质单的列显示（序号与备注默认收起，需要时在工具栏打开）
  const [hiddenCols, setHiddenCols] = useState<string[]>(["idx", "remark"]);
  const [showRmb, setShowRmb] = useState(true);
  const [showSign, setShowSign] = useState(true);
  /** 见 PRINT_MODES：三联复写纸只打一遍，A4 纸才是三份 */
  const [printMode, setPrintMode] = useState<PrintModeKey>("carbon");

  const visibleCols = ALL_COLS.filter((c) => !hiddenCols.includes(c.key));

  // ---- 打印模板：存的是版式（打印方式/列/显示选项/收款账户/抬头页脚），不含单据内容 ----
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tplName, setTplName] = useState("");
  const [tplMsg, setTplMsg] = useState<string | null>(null);
  const [tplBusy, setTplBusy] = useState(false);
  const [tplConfirmDelete, setTplConfirmDelete] = useState(false);

  /** 当前界面上的设置 → 模板配置 */
  function configFromState(): PrintTemplateConfig {
    return {
      printMode,
      hiddenCols,
      showRmb,
      showSign,
      account,
      title,
      company: letterhead.company,
      address: letterhead.address,
      phone: letterhead.phone,
    };
  }

  function applyTemplate(t: PrintTemplateDTO) {
    const c = t.config;
    setPrintMode(c.printMode);
    setHiddenCols(c.hiddenCols);
    setShowRmb(c.showRmb);
    setShowSign(c.showSign);
    setAccount(c.account);
    setTitle(c.title);
    // 抬头为空时不动本地已记住的值，免得空模板把之前填好的地址电话抹掉
    const patch: Partial<Letterhead> = { company: c.company };
    if (c.address) patch.address = c.address;
    if (c.phone) patch.phone = c.phone;
    writeLetterhead(patch);
    setTplName(t.name);
    setTplConfirmDelete(false);
  }

  // 打开打印页时套用默认模板（列表已按 isDefault 优先排序）；只套一次，之后用户改的不覆盖
  useEffect(() => {
    if (templates.length === 0) return;
    const first = templates.find((t) => t.isDefault) ?? templates[0];
    // 套用模板要等挂载后才能做（服务端渲染时还不知道用哪套），这里必然 setState，豁免该规则
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    applyTemplate(first);
    setSelectedId(first.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveTemplate(overwrite: boolean) {
    const current = selectedId != null ? templates.find((t) => t.id === selectedId) : undefined;
    const name = (overwrite ? (current?.name ?? tplName) : tplName).trim();
    if (!name) {
      setTplMsg("请先填写模板名称");
      return;
    }
    setTplBusy(true);
    setTplMsg(null);
    const r = await savePrintTemplateAction({
      id: overwrite ? current?.id : undefined,
      name,
      config: configFromState(),
      isDefault: overwrite ? !!current?.isDefault : false,
    });
    setTplBusy(false);
    setTplMsg(r?.error ?? r?.ok ?? null);
    if (r?.id) setSelectedId(r.id);
    if (r?.ok) router.refresh();
  }

  async function makeDefault() {
    if (selectedId == null) return;
    setTplBusy(true);
    setTplMsg(null);
    const r = await setDefaultPrintTemplateAction(selectedId);
    setTplBusy(false);
    setTplMsg(r?.error ?? r?.ok ?? null);
    if (r?.ok) router.refresh();
  }

  async function removeTemplate() {
    if (selectedId == null) return;
    setTplBusy(true);
    setTplMsg(null);
    const r = await deletePrintTemplateAction(selectedId);
    setTplBusy(false);
    setTplMsg(r?.error ?? r?.ok ?? null);
    if (r?.ok) {
      setSelectedId(null);
      setTplConfirmDelete(false);
      router.refresh();
    }
  }

  function rowAmount(row: (typeof rows)[number]): number {
    const q = Number(row.qty);
    const p = Number(row.price);
    return Number.isFinite(q) && Number.isFinite(p) ? q * p : 0;
  }
  const totalAmount = rows.reduce((s, r) => s + rowAmount(r), 0);
  const totalQty = rows.reduce((s, r) => {
    const q = Number(r.qty);
    return s + (Number.isFinite(q) ? q : 0);
  }, 0);
  const netAmount = totalAmount - (Number(discount) || 0);

  function updateRow(index: number, patch: Partial<(typeof rows)[number]>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((prev) => [...prev, { code: "", name: "", qty: "", unit: "", price: "", remark: "" }]);
  }
  function removeRow(index: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }
  function toggleCol(key: string) {
    setHiddenCols((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  /** 一联的内容（除联次标识外三份完全相同） */
  function renderSlip(copyLabel: ReactNode) {
    return (
      <div className="print-slip mx-auto w-full bg-white font-sans text-gray-900">
        {/* 抬头 */}
        <div className="text-center text-xl font-bold tracking-widest leading-8">
          <input
            value={company}
            onChange={(e) => writeLetterhead({ company: e.target.value })}
            className={`${inputBase} inline-block text-center text-xl font-bold tracking-widest`}
            style={{ width: `${Math.max(company.length, 6) + 2}em` }}
          />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={`${inputBase} inline-block text-center text-xl font-bold tracking-widest`}
            style={{ width: `${Math.max(title.length, 3) + 2}em` }}
          />
        </div>

        {/* 抬头信息：每行用 flex 排，标签与值始终在同一行（固定宽度输入框会换行） */}
        <div className="mt-1.5 space-y-0.5 text-[13px] leading-6">
          <div className="flex items-center gap-1">
            <span className="shrink-0">录单日期：</span>
            <input
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
              className={`${inputBase} w-28 shrink-0`}
            />
            <span className="ml-auto shrink-0">单据编号：</span>
            <input
              value={orderNo}
              onChange={(e) => setOrderNo(e.target.value)}
              className={`${inputBase} w-44 shrink-0`}
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="shrink-0">购买单位：</span>
            <input
              value={buyer}
              onChange={(e) => setBuyer(e.target.value)}
              className={`${inputBase} min-w-0 flex-1`}
            />
            <span className="ml-4 shrink-0">经手人：</span>
            <input
              value={handler}
              onChange={(e) => setHandler(e.target.value)}
              className={`${inputBase} w-24 shrink-0`}
            />
            <span className="ml-4 shrink-0">制单人：</span>
            <input
              value={maker}
              onChange={(e) => setMaker(e.target.value)}
              className={`${inputBase} w-24 shrink-0`}
            />
          </div>
          {/* 送货地址：比原纸质单多的一栏 */}
          <div className="flex items-center gap-1">
            <span className="shrink-0">送货地址：</span>
            <input
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
              className={`${inputBase} min-w-0 flex-1`}
              placeholder="（选填）送货地址"
            />
          </div>
        </div>

        {/* 明细表 */}
        <table className="mt-1 w-full border-collapse text-[13px]">
          <thead>
            <tr>
              {visibleCols.map((c) => (
                <th
                  key={c.key}
                  className={`border border-gray-800 px-1 py-0.5 font-semibold ${
                    c.right ? "text-right" : "text-left"
                  }`}
                >
                  {c.label}
                </th>
              ))}
              <th className="print:hidden w-12 border border-gray-300 px-1 text-center font-normal text-gray-400">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {visibleCols.map((c) => (
                  <td key={c.key} className="border border-gray-800 px-1 py-0.5">
                    {c.key === "idx" ? (
                      <span className="block text-center">{i + 1}</span>
                    ) : c.key === "amount" ? (
                      <span className="block text-right tabular-nums">{rowAmount(row).toFixed(2)}</span>
                    ) : (
                      <input
                        value={row[c.key as keyof typeof row]}
                        onChange={(e) => updateRow(i, { [c.key]: e.target.value })}
                        className={`${inputFill} ${c.right ? "text-right" : ""}`}
                      />
                    )}
                  </td>
                ))}
                <td className="print:hidden w-12 border border-gray-300 px-1 text-center">
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    className="whitespace-nowrap text-xs text-red-600 hover:underline"
                  >
                    删
                  </button>
                </td>
              </tr>
            ))}
            {/* 总计：数量与金额合计 */}
            <tr className="font-semibold">
              <td colSpan={Math.max(visibleCols.findIndex((c) => c.key === "qty"), 1)} className="border border-gray-800 px-1 py-0.5">
                总计
              </td>
              <td className="whitespace-nowrap border border-gray-800 px-1 py-0.5 text-right tabular-nums">
                {totalQty.toFixed(3)}
              </td>
              <td className="border border-gray-800 px-1 py-0.5" />
              <td className="whitespace-nowrap border border-gray-800 px-1 py-0.5 text-right tabular-nums">
                {totalAmount.toFixed(2)}
              </td>
              {visibleCols.filter((c) => ["remark", "idx"].includes(c.key)).map((c) => (
                <td key={c.key} className="border border-gray-800" />
              ))}
              <td className="print:hidden border border-gray-300" />
            </tr>
          </tbody>
        </table>

        <div className="text-[13px] leading-6">
          {showRmb && (
            <div>
              大写：<span className="font-semibold">{rmbUpper(netAmount)}</span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-6">
            <span>
              收款账户：
              <input
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                className={`${inputBase} w-56`}
                placeholder="银行 / 账号"
              />
            </span>
            <span>
              收款金额：
              <input
                value={received}
                onChange={(e) => setReceived(e.target.value)}
                className={`${inputBase} w-24 text-right`}
              />
            </span>
            <span>
              优惠金额：
              <input
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                className={`${inputBase} w-20 text-right`}
              />
            </span>
          </div>
          {data.remark && <div>整单备注：{data.remark}</div>}
        </div>

        {/* 联次标识 */}
        <div className="mt-0.5 border-t border-gray-800 pt-0.5 text-[12px] font-medium">
          {copyLabel}
        </div>

        {/* 页脚：公司地址单独一行（留足书写/盖章空间），电话与客户签收在下一行 */}
        <div className="mt-0.5 space-y-0.5 border-t border-gray-800 pt-0.5 text-[12px]">
          <div className="flex items-center gap-1">
            <span className="shrink-0 font-medium">公司地址：</span>
            <input
              value={footerAddress}
              onChange={(e) => writeLetterhead({ address: e.target.value })}
              className={`${inputBase} h-6 min-w-0 flex-1 px-1`}
              placeholder="公司地址（填一次即记住，也可在打印稿上直接写）"
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="shrink-0">电话：</span>
            <input
              value={footerPhone}
              onChange={(e) => writeLetterhead({ phone: e.target.value })}
              className={`${inputBase} h-6 w-72 shrink-0 px-1`}
              placeholder="联系电话（同地址，填一次即记住）"
            />
            {showSign && <span className="ml-auto shrink-0">客户签收：＿＿＿＿＿＿</span>}
          </div>
        </div>
      </div>
    );
  }

  /** 复写纸模式：联次标识按纸质单的样式并排印一行（纸自己分三层，所以只出一份） */
  const threeLabelsRow = (
    <div className="grid grid-cols-3">
      {COPY_LABELS.map((t) => (
        <span key={t} className="text-center">
          {t}
        </span>
      ))}
    </div>
  );

  const slips: { key: string; label: ReactNode }[] =
    printMode === "carbon"
      ? [{ key: "carbon", label: threeLabelsRow }]
      : COPY_LABELS.map((t, i) => ({ key: `copy-${i}`, label: <span className="block text-center">{t}</span> }));

  return (
    <div className="mx-auto max-w-4xl p-6">
      {/* 工具栏（打印时隐藏） */}
      <div className="print:hidden mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => window.print()} className={`${btnPrimary} shadow-sm`}>
            打印
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.history.length > 1) window.history.back();
              else window.close();
            }}
            className={btnSecondary}
          >
            返回
          </button>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-gray-500">打印方式</span>
            {PRINT_MODES.map((m) => (
              <Chip key={m.key} on={printMode === m.key} onClick={() => setPrintMode(m.key)}>
                {m.label}
              </Chip>
            ))}
          </div>
        </div>

        {/* 打印模板：选一套即套用上面的打印方式/列/显示选项 + 收款账户与抬头页脚 */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
          <span className="text-xs font-medium text-gray-500">打印模板</span>
          <select
            value={selectedId ?? ""}
            onChange={(e) => {
              const id = Number(e.target.value);
              setSelectedId(id > 0 ? id : null);
              setTplConfirmDelete(false);
              const t = templates.find((x) => x.id === id);
              if (t) applyTemplate(t);
            }}
            className={`${selectCls} w-48 py-1 text-xs`}
          >
            <option value="">（不套用模板）</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.isDefault ? "（默认）" : ""}
              </option>
            ))}
          </select>
          {canManage ? (
            <>
              <input
                value={tplName}
                onChange={(e) => setTplName(e.target.value)}
                maxLength={50}
                placeholder="模板名称"
                className="w-32 rounded-md border border-gray-300 px-2 py-1 text-xs"
              />
              <button
                type="button"
                onClick={() => void saveTemplate(false)}
                disabled={tplBusy}
                className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 transition hover:border-blue-300 hover:text-blue-600 disabled:opacity-50"
              >
                另存为新模板
              </button>
              {selectedId != null && (
                <>
                  <button
                    type="button"
                    onClick={() => void saveTemplate(true)}
                    disabled={tplBusy}
                    className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 transition hover:border-blue-300 hover:text-blue-600 disabled:opacity-50"
                  >
                    保存到该模板
                  </button>
                  <button
                    type="button"
                    onClick={() => void makeDefault()}
                    disabled={tplBusy}
                    className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 transition hover:border-blue-300 hover:text-blue-600 disabled:opacity-50"
                  >
                    设为默认
                  </button>
                  {tplConfirmDelete ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void removeTemplate()}
                        disabled={tplBusy}
                        className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-600 disabled:opacity-50"
                      >
                        确认删除
                      </button>
                      <button
                        type="button"
                        onClick={() => setTplConfirmDelete(false)}
                        className="text-xs text-gray-500 hover:underline"
                      >
                        取消
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setTplConfirmDelete(true)}
                      disabled={tplBusy}
                      className="text-xs text-gray-400 transition hover:text-red-600 hover:underline disabled:opacity-50"
                    >
                      删除模板
                    </button>
                  )}
                </>
              )}
            </>
          ) : (
            <span className="text-xs text-gray-400">模板由管理员维护，你选一套用即可</span>
          )}
          {tplMsg && <span className="text-xs text-gray-500">{tplMsg}</span>}
        </div>

        <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1.5 text-xs font-medium text-gray-500">打印列</span>
            {ALL_COLS.map((c) => (
              <Chip key={c.key} on={!hiddenCols.includes(c.key)} onClick={() => toggleCol(c.key)}>
                {c.label}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1.5 text-xs font-medium text-gray-500">显示选项</span>
            <Chip on={showRmb} onClick={() => setShowRmb((v) => !v)}>
              大写金额
            </Chip>
            <Chip on={showSign} onClick={() => setShowSign((v) => !v)}>
              签收栏
            </Chip>
            <button
              type="button"
              onClick={addRow}
              className="ml-auto rounded-full border border-dashed border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:border-blue-300 hover:text-blue-600"
            >
              ＋ 添加行
            </button>
          </div>
        </div>

        <p className="mt-3 border-t border-gray-100 pt-2.5 text-xs text-gray-500">
          提示：表单里的文字都可直接点击修改（含送货地址、收款账户、公司地址电话）；行可添加 / 删除。
          <span className="ml-1 text-gray-600">
            「三联复写纸（打一遍）」= 用三层复写纸+针式打印机，只出一份单据，纸自己会复写出三层；
            「A4 三联同页 / 每联一页」= 普通 A4 纸，靠打印三份（打印后裁开或分页）。
          </span>
          <span className="ml-1 font-medium text-amber-600">
            这里的修改只作用于本次打印稿，不会保存到订单；如需修改订单请用「作废后重开」或退货。
          </span>
          <span className="ml-1 text-gray-600">
            「打印模板」能把打印方式、打印列、显示选项连同收款账户与抬头页脚存成一套，下次直接选用
            （存的是版式，不含单据内容）。
          </span>
        </p>
      </div>

      {/* 打印内容 */}
      <div className="mx-auto max-w-3xl print:max-w-none">
        {slips.map((s, i) => (
          <div
            key={s.key}
            className={`print-slip-wrap ${
              i > 0
                ? "mt-6 border-t border-dashed border-gray-300 pt-6 print:mt-0 print:border-t-0 print:pt-0"
                : ""
            } ${printMode === "a4-pages" && i > 0 ? "print:break-before-page" : ""}`}
          >
            {renderSlip(s.label)}
          </div>
        ))}
      </div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
        on
          ? "border-blue-300 bg-blue-50 text-blue-700"
          : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"
      }`}
    >
      {children}
    </button>
  );
}
