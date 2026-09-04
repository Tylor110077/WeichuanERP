"use client";

import { useState, useTransition } from "react";
import { saveCuPriceAction, type FormState } from "./actions";

const inputCls = "mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900";

/** 铜价录入：日期、日价必填；当日时点（时间/价格）可选，可加多行。 */
export function MarketDataForm({ defaultDate }: { defaultDate: string }) {
  const [priceDate, setPriceDate] = useState(defaultDate);
  const [price, setPrice] = useState("");
  const [points, setPoints] = useState<{ time: string; price: string }[]>([{ time: "", price: "" }]);
  const [msg, setMsg] = useState<FormState>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    const data = {
      priceDate,
      price: Number(price),
      points: points
        .filter((p) => p.time && p.price !== "")
        .map((p) => ({ time: p.time, price: Number(p.price) })),
    };
    startTransition(async () => {
      const res = await saveCuPriceAction(data);
      setMsg(res);
      if (res?.ok) {
        setPrice("");
        setPoints([{ time: "", price: "" }]);
      }
    });
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-semibold text-gray-900">录入铜价</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label className="block text-xs font-medium text-gray-600">日期 *</label>
          <input
            type="date"
            value={priceDate}
            onChange={(e) => setPriceDate(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">当日铜价（元/吨）*</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="如 78500"
            className={inputCls}
          />
        </div>
      </div>

      <div className="mt-3">
        <label className="block text-xs font-medium text-gray-600">
          当日时点波动（可选，用于当日趋势图）
        </label>
        <div className="mt-1 space-y-2">
          {points.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="time"
                value={p.time}
                onChange={(e) =>
                  setPoints((prev) => prev.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)))
                }
                className={`${inputCls} w-36`}
              />
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="时点价格"
                value={p.price}
                onChange={(e) =>
                  setPoints((prev) => prev.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))
                }
                className={inputCls}
              />
              <button
                type="button"
                onClick={() => setPoints((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev))}
                className="text-xs text-red-500 hover:underline"
              >
                删除
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setPoints((prev) => [...prev, { time: "", price: "" }])}
          className="mt-1 text-xs text-blue-600 hover:underline"
        >
          + 添加时点
        </button>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={pending || !priceDate || price === ""}
          className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? "保存中…" : "保存行情"}
        </button>
        {msg?.error && <p className="text-sm text-red-600">{msg.error}</p>}
        {msg?.ok && <p className="text-sm text-green-600">{msg.ok}</p>}
      </div>
    </div>
  );
}
