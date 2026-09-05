"use client";

import { useEffect, useState, type ReactNode } from "react";
import { rmbUpper } from "@/lib/rmb";

export interface PrintOrderData {
  orderNo: string;
  createdAt: string;
  customer: { name: string; contact: string; phone: string; address: string };
  operatorName: string;
  remark: string;
  rows: { code: string; name: string; qty: number; unit: string; price: number }[];
}

const ALL_COLS = [
  { key: "idx", label: "#" },
  { key: "code", label: "编码" },
  { key: "name", label: "商品名称" },
  { key: "qty", label: "数量", right: true },
  { key: "unit", label: "单位" },
  { key: "price", label: "单价", right: true },
  { key: "amount", label: "金额", right: true },
];

const inputCls =
  "w-full bg-transparent outline-none focus:bg-blue-50 rounded px-1 text-inherit";

/** 打印前可编辑预览：标题/抬头/列显隐/行内容/行数均可编辑，所见即所得打印。 */
export function PrintEditor({ data }: { data: PrintOrderData }) {
  const [title, setTitle] = useState("销售单（发货单）");
  const [orderNo, setOrderNo] = useState(data.orderNo);
  const [orderDate, setOrderDate] = useState(data.createdAt);
  const [customer, setCustomer] = useState(data.customer);
  const [remark, setRemark] = useState(data.remark);
  const [operatorName, setOperatorName] = useState(data.operatorName);
  const [rows, setRows] = useState(
    data.rows.map((r) => ({
      code: r.code,
      name: r.name,
      qty: r.qty.toFixed(3),
      unit: r.unit,
      price: r.price.toFixed(2),
    }))
  );
  const [hiddenCols, setHiddenCols] = useState<string[]>([]);
  const [showRmb, setShowRmb] = useState(true);
  const [showSign, setShowSign] = useState(true);
  // 打印时间只能客户端生成（SSR 时钟与浏览器不一致会 hydration 失败），挂载后再填充
  const [printTime, setPrintTime] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setPrintTime(new Date().toLocaleString("zh-CN"));
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const visibleCols = ALL_COLS.filter((c) => !hiddenCols.includes(c.key));

  function rowAmount(row: (typeof rows)[number]): number {
    const q = Number(row.qty);
    const p = Number(row.price);
    return Number.isFinite(q) && Number.isFinite(p) ? q * p : 0;
  }
  const total = rows.reduce((s, r) => s + rowAmount(r), 0);

  function updateRow(index: number, patch: Partial<(typeof rows)[number]>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((prev) => [...prev, { code: "", name: "", qty: "", unit: "", price: "" }]);
  }
  function removeRow(index: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }
  function toggleCol(key: string) {
    setHiddenCols((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      {/* 工具栏（打印时隐藏） */}
      <div className="print:hidden mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        {/* 主操作行 */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
          >
            打印
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.history.length > 1) {
                window.history.back();
              } else {
                window.close();
              }
            }}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            返回
          </button>
          <div className="ml-auto flex items-center gap-2">
            <label className="text-xs text-gray-500">单据标题</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-48 rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 focus:border-blue-400 focus:outline-none"
            />
          </div>
        </div>

        {/* 选项行：打印列 / 显示选项 / 添加行 */}
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

        {/* 提示行 */}
        <p className="mt-3 border-t border-gray-100 pt-2.5 text-xs text-gray-400">
          提示：直接点击单据中的文字即可编辑；行可添加 / 删除；调整满意后点「打印」。
        </p>
      </div>

      {/* 单据预览（打印内容） */}
      <div className="mx-auto max-w-3xl bg-white p-8 font-sans text-sm text-gray-900 print:max-w-none print:p-0">
        <div className="mb-6 border-b-2 border-gray-900 pb-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mb-2 w-full bg-transparent text-center text-2xl font-bold tracking-widest outline-none"
          />
          <div className="flex justify-between text-xs text-gray-600">
            <span>
              单号：
              <input
                value={orderNo}
                onChange={(e) => setOrderNo(e.target.value)}
                className="w-40 bg-transparent outline-none"
              />
            </span>
            <span>
              日期：
              <input
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
                className="w-28 bg-transparent outline-none"
              />
            </span>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-2 rounded border border-gray-300 p-3 text-sm">
          <div>
            <span className="text-gray-500">客户：</span>
            <input
              value={customer.name}
              onChange={(e) => setCustomer((c) => ({ ...c, name: e.target.value }))}
              className="w-32 bg-transparent font-medium outline-none"
            />
          </div>
          <div>
            <span className="text-gray-500">联系人：</span>
            <input
              value={customer.contact}
              onChange={(e) => setCustomer((c) => ({ ...c, contact: e.target.value }))}
              className="w-24 bg-transparent outline-none"
            />
          </div>
          <div>
            <span className="text-gray-500">电话：</span>
            <input
              value={customer.phone}
              onChange={(e) => setCustomer((c) => ({ ...c, phone: e.target.value }))}
              className="w-28 bg-transparent outline-none"
            />
          </div>
          <div className="col-span-3">
            <span className="text-gray-500">地址：</span>
            <input
              value={customer.address}
              onChange={(e) => setCustomer((c) => ({ ...c, address: e.target.value }))}
              className="w-full bg-transparent outline-none"
            />
          </div>
        </div>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-y-2 border-gray-900 bg-gray-50 text-left">
              {visibleCols.map((c) => (
                <th
                  key={c.key}
                  className={`px-2 py-2 ${c.right ? "text-right" : ""}`}
                >
                  {c.label}
                </th>
              ))}
              <th className="print:hidden px-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const amount = rowAmount(row);
              const cellCls = "px-2 py-1.5";
              return (
                <tr key={idx} className="border-b border-gray-200">
                  {visibleCols.map((c) => {
                    if (c.key === "idx")
                      return (
                        <td key={c.key} className={`${cellCls} text-gray-500`}>
                          {idx + 1}
                        </td>
                      );
                    if (c.key === "code")
                      return (
                        <td key={c.key} className={cellCls}>
                          <input
                            value={row.code}
                            onChange={(e) => updateRow(idx, { code: e.target.value })}
                            className={inputCls}
                          />
                        </td>
                      );
                    if (c.key === "name")
                      return (
                        <td key={c.key} className={cellCls}>
                          <input
                            value={row.name}
                            onChange={(e) => updateRow(idx, { name: e.target.value })}
                            className={inputCls}
                          />
                        </td>
                      );
                    if (c.key === "qty")
                      return (
                        <td key={c.key} className={cellCls}>
                          <input
                            value={row.qty}
                            onChange={(e) => updateRow(idx, { qty: e.target.value })}
                            className={`${inputCls} text-right`}
                          />
                        </td>
                      );
                    if (c.key === "unit")
                      return (
                        <td key={c.key} className={cellCls}>
                          <input
                            value={row.unit}
                            onChange={(e) => updateRow(idx, { unit: e.target.value })}
                            className={inputCls}
                          />
                        </td>
                      );
                    if (c.key === "price")
                      return (
                        <td key={c.key} className={cellCls}>
                          <input
                            value={row.price}
                            onChange={(e) => updateRow(idx, { price: e.target.value })}
                            className={`${inputCls} text-right`}
                          />
                        </td>
                      );
                    return (
                      <td key={c.key} className={`${cellCls} text-right font-medium`}>
                        ¥{amount.toFixed(2)}
                      </td>
                    );
                  })}
                  <td className="print:hidden px-1 text-center">
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      className="text-xs text-red-500 hover:underline"
                    >
                      删
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-900">
              <td colSpan={Math.max(visibleCols.length - 1, 1)} className="px-2 py-2 text-right font-bold">
                {showRmb ? `合计（大写：${rmbUpper(total)}）` : "合计"}
              </td>
              <td className="px-2 py-2 text-right text-base font-bold">¥{total.toFixed(2)}</td>
              <td className="print:hidden" />
            </tr>
          </tfoot>
        </table>

        <div className="mt-3 text-sm text-gray-600">
          备注：
          <input
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            className="w-1/2 bg-transparent outline-none"
          />
          　开单操作人：
          <input
            value={operatorName}
            onChange={(e) => setOperatorName(e.target.value)}
            className="w-24 bg-transparent outline-none"
          />
        </div>

        {showSign && (
          <div className="mt-10 flex justify-between text-sm">
            <div className="w-64 border-t border-gray-900 pt-1 text-center text-gray-600">
              客户签收 / 日期
            </div>
            <div className="w-64 border-t border-gray-900 pt-1 text-center text-gray-600">
              发货人 / 日期
            </div>
          </div>
        )}

        <p className="mt-6 text-center text-xs text-gray-400">
          玮川进销存 ・ {orderNo}
          {printTime ? ` ・ 打印时间 ${printTime}` : ""}
        </p>
      </div>
    </div>
  );
}

/** 可点选的开关 chip：选中为蓝底，未选中为灰边淡字。 */
function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
        on
          ? "border-blue-200 bg-blue-50 text-blue-700"
          : "border-gray-200 bg-white text-gray-400 hover:border-gray-300 hover:text-gray-600"
      }`}
    >
      {children}
    </button>
  );
}
