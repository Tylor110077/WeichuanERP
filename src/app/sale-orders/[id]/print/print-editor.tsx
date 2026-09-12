"use client";

import { useState, type ReactNode } from "react";
import { btnPrimary, btnSecondary } from "@/lib/ui";
import { rmbUpper } from "@/lib/rmb";

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

export interface PrintOrderData {
  orderNo: string;
  createdAt: string;
  customer: { name: string; contact: string; phone: string; address: string };
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

/** 打印联次（与纸质三联单一致） */
const COPIES = [
  { key: "stub", label: "第一联：存根联" },
  { key: "settle", label: "第二联：结账联" },
  { key: "customer", label: "第三联：客户联" },
] as const;

/**
 * 打印稿里的输入框样式。
 * 注意：不能把 w-full 混进通用样式里——Tailwind 里 w-full 的优先级高于 w-28 这类固定宽度，
 * 会让所有「固定宽度」的输入框被撑满整行（之前抬头几行就是这样错位的）。
 * 所以拆成两个：表格单元格用 inputFill（填满单元格），其它位置用 inputBase + 显式宽度。
 */
const inputBase = "bg-transparent outline-none focus:bg-blue-50 rounded px-1 text-inherit";
const inputFill = `${inputBase} w-full`;

export function PrintEditor({ data }: { data: PrintOrderData }) {
  const [company, setCompany] = useState(DEFAULT_COMPANY);
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
  const [footerAddress, setFooterAddress] = useState(DEFAULT_FOOTER_ADDRESS);
  const [footerPhone, setFooterPhone] = useState(DEFAULT_FOOTER_PHONE);
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
  /** three=三联同页｜page=每联一页｜single=只打一联 */
  const [copyMode, setCopyMode] = useState<"three" | "page" | "single">("three");

  const visibleCols = ALL_COLS.filter((c) => !hiddenCols.includes(c.key));

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

  /** 一联的内容（三联除联名外完全相同） */
  function renderSlip(copyLabel: string) {
    return (
      <div className="print-slip mx-auto w-full bg-white font-sans text-gray-900">
        {/* 抬头 */}
        <div className="text-center text-xl font-bold tracking-widest leading-8">
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
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
              <th className="print:hidden border border-gray-300 px-1 text-center font-normal text-gray-400">
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
                <td className="print:hidden border border-gray-300 px-1 text-center">
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    className="text-xs text-red-600 hover:underline"
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
              <td className="border border-gray-800 px-1 py-0.5 text-right tabular-nums">
                {totalQty.toFixed(3)}
              </td>
              <td className="border border-gray-800 px-1 py-0.5" />
              <td className="border border-gray-800 px-1 py-0.5 text-right tabular-nums">
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
        <div className="mt-0.5 border-t border-gray-800 pt-0.5 text-center text-[12px] font-medium">
          {copyLabel}
        </div>

        {/* 页脚 */}
        <div className="mt-0.5 flex items-center gap-1 border-t border-gray-800 pt-0.5 text-[12px]">
          <span className="shrink-0">地址：</span>
          <input
            value={footerAddress}
            onChange={(e) => setFooterAddress(e.target.value)}
            className={`${inputBase} min-w-0 flex-1`}
            placeholder="公司地址"
          />
          <span className="ml-3 shrink-0">电话：</span>
          <input
            value={footerPhone}
            onChange={(e) => setFooterPhone(e.target.value)}
            className={`${inputBase} w-36 shrink-0`}
            placeholder="联系电话"
          />
          {showSign && <span className="ml-3 shrink-0">客户签收：＿＿＿＿＿＿</span>}
        </div>
      </div>
    );
  }

  const slips =
    copyMode === "single"
      ? [{ key: "single", label: "第一联：存根联" }]
      : COPIES.map((c) => ({ key: c.key, label: c.label }));

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
            <span className="text-xs font-medium text-gray-500">联次</span>
            {(
              [
                { key: "three", label: "三联同页" },
                { key: "page", label: "每联一页" },
                { key: "single", label: "只打一联" },
              ] as const
            ).map((m) => (
              <Chip key={m.key} on={copyMode === m.key} onClick={() => setCopyMode(m.key)}>
                {m.label}
              </Chip>
            ))}
          </div>
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
          提示：表单里的文字都可直接点击修改（含送货地址、收款账户、页脚地址电话）；行可添加 / 删除；
          「联次」决定打几张：三联同页 = 一页里三份（复写纸或打后裁切），每联一页 = 三张单据。
          <span className="ml-1 font-medium text-amber-600">
            这里的修改只作用于本次打印稿，不会保存到订单；如需修改订单请用「作废后重开」或退货。
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
            } ${copyMode === "page" && i > 0 ? "print:break-before-page" : ""}`}
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
