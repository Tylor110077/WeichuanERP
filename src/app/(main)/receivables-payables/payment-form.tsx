"use client";

import { useActionState, useState } from "react";
import { createPaymentAction, type FormState } from "./actions";

interface SaleOption {
  id: number;
  orderNo: string;
  customerName: string;
  outstanding: number;
}
interface PurchaseOption {
  id: number;
  orderNo: string;
  supplierName: string;
  outstanding: number;
}

const inputCls = "mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm";

export function PaymentForm({
  saleOrders,
  purchaseOrders,
  lockedDirection,
}: {
  saleOrders: SaleOption[];
  purchaseOrders: PurchaseOption[];
  /** 视图锁定：应收视图只允许登记收款，应付视图只允许付款 */
  lockedDirection?: "receipt" | "payment";
}) {
  const [direction, setDirection] = useState<"receipt" | "payment">(lockedDirection ?? "receipt");
  const [orderId, setOrderId] = useState("");
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createPaymentAction,
    null
  );

  const options =
    direction === "receipt"
      ? saleOrders.map((o) => ({ value: String(o.id), label: `${o.orderNo} ${o.customerName}（未收 ¥${o.outstanding.toFixed(2)}）` }))
      : purchaseOrders.map((o) => ({ value: String(o.id), label: `${o.orderNo} ${o.supplierName}（未付 ¥${o.outstanding.toFixed(2)}）` }));

  return (
    <form action={formAction} className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-semibold text-gray-900">收付款登记</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="direction" className="block text-xs font-medium text-gray-600">
            方向 *
          </label>
          {lockedDirection ? (
            <span className="mt-1 block rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-sm text-gray-600">
              {lockedDirection === "receipt" ? "收款（客户）" : "付款（供应商）"}
            </span>
          ) : (
            <select
              id="direction"
              name="direction"
              value={direction}
              onChange={(e) => {
                setDirection(e.target.value as "receipt" | "payment");
                setOrderId("");
              }}
              className={inputCls}
            >
              <option value="receipt">收款（客户）</option>
              <option value="payment">付款（供应商）</option>
            </select>
          )}
        </div>
        <div>
          <label htmlFor="orderId" className="block text-xs font-medium text-gray-600">
            关联单据 *
          </label>
          <select
            id="orderId"
            name="orderId"
            required
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            className={inputCls}
          >
            <option value="">请选择</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <input type="hidden" name="orderType" value={direction === "receipt" ? "sale" : "purchase"} />
        </div>
        <div>
          <label htmlFor="amount" className="block text-xs font-medium text-gray-600">
            金额 *
          </label>
          <input
            id="amount"
            name="amount"
            type="number"
            min="0.01"
            step="0.01"
            required
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="method" className="block text-xs font-medium text-gray-600">
            方式 *
          </label>
          <select id="method" name="method" required className={inputCls}>
            <option value="cash">现金</option>
            <option value="bank">银行转账</option>
            <option value="wechat">微信</option>
            <option value="alipay">支付宝</option>
            <option value="other">其他</option>
          </select>
        </div>
        <div>
          <label htmlFor="payment-remark" className="block text-xs font-medium text-gray-600">
            备注
          </label>
          <input id="payment-remark" name="remark" type="text" maxLength={200} className={inputCls} />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending || !orderId}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? "登记中…" : "确认登记"}
        </button>
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state?.ok && <p className="text-sm text-green-600">{state.ok}</p>}
      </div>
    </form>
  );
}
