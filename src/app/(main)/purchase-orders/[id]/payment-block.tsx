"use client";

import { useActionState, useState } from "react";
import {
  createPaymentAction,
  voidPaymentAction,
  type FormState,
} from "../../receivables-payables/actions";

const METHOD_LABELS: Record<string, string> = {
  cash: "现金",
  bank: "银行转账",
  wechat: "微信",
  alipay: "支付宝",
  other: "其他",
};

interface PaymentRow {
  id: number;
  orderNo: string;
  amount: number;
  method: string;
  createdAt: string;
  operatorName: string;
  status: string;
}

export function PaymentBlock({
  orderId,
  orderStatus,
  outstanding,
  payments,
  canPay,
}: {
  orderId: number;
  orderStatus: string;
  outstanding: number;
  payments: PaymentRow[];
  canPay: boolean;
}) {
  const [showPayForm, setShowPayForm] = useState(false);
  const [showVoidFor, setShowVoidFor] = useState<number | null>(null);
  const [payState, payAction, payPending] = useActionState<FormState, FormData>(
    createPaymentAction,
    null
  );
  const [voidState, voidAction, voidPending] = useActionState<FormState, FormData>(
    voidPaymentAction,
    null
  );

  const inputCls = "rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900";
  const paidTotal = payments
    .filter((p) => p.status === "confirmed")
    .reduce((s, p) => s + p.amount, 0);
  const message = payState?.ok ?? payState?.error ?? voidState?.ok ?? voidState?.error;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-semibold text-gray-900">付款记录</h2>
      <div className="flex flex-wrap items-center gap-4">
        <div className="text-sm">
          <span className="text-gray-500">已付：</span>
          <span className="font-medium text-gray-900">¥{paidTotal.toFixed(2)}</span>
        </div>
        <div className="text-sm">
          <span className="text-gray-500">未付：</span>
          <span className={`font-medium ${outstanding > 0 ? "text-red-600" : "text-gray-900"}`}>
            ¥{Math.max(outstanding, 0).toFixed(2)}
          </span>
        </div>
        {canPay && outstanding > 0 && orderStatus !== "voided" && (
          <button
            type="button"
            onClick={() => setShowPayForm((v) => !v)}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            {showPayForm ? "取消" : "付款"}
          </button>
        )}
        {!canPay && <span className="text-xs text-gray-400">付款登记权限：管理员/老板</span>}
      </div>

      {showPayForm && (
        <form action={payAction} className="mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 p-3">
          <input type="hidden" name="direction" value="payment" />
          <input type="hidden" name="orderType" value="purchase" />
          <input type="hidden" name="orderId" value={orderId} />
          <div>
            <label className="block text-xs text-gray-600">金额 *</label>
            <input
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              required
              defaultValue={outstanding.toFixed(2)}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600">方式 *</label>
            <select name="method" required className={inputCls}>
              {Object.entries(METHOD_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600">备注</label>
            <input name="remark" type="text" maxLength={200} className={inputCls} />
          </div>
          <button
            type="submit"
            disabled={payPending}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {payPending ? "登记中…" : "确认付款"}
          </button>
        </form>
      )}

      <div className="mt-4 space-y-2">
        {payments.length === 0 && <p className="text-sm text-gray-400">暂无付款记录</p>}
        {payments.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-100 px-3 py-2 text-sm">
            <span className="font-medium text-gray-900">¥{p.amount.toFixed(2)}</span>
            <span className="text-gray-600">{METHOD_LABELS[p.method] ?? p.method}</span>
            <span className="text-gray-500">{p.orderNo} ・ {p.createdAt} ・ {p.operatorName}</span>
            {p.status === "confirmed" && canPay ? (
              <span className="ml-auto flex items-center gap-2">
                {showVoidFor === p.id ? (
                  <form action={voidAction} className="flex items-center gap-1">
                    <input type="hidden" name="id" value={p.id} />
                    <input
                      name="reason"
                      placeholder="撤销原因（必填）"
                      required
                      className="w-44 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-900"
                    />
                    <button
                      type="submit"
                      disabled={voidPending}
                      className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {voidPending ? "处理中…" : "确认撤销"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowVoidFor(null)}
                      className="text-xs text-gray-500 hover:underline"
                    >
                      取消
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowVoidFor(p.id)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    撤销付款
                  </button>
                )}
              </span>
            ) : (
              <span className="ml-auto text-xs text-gray-400">
                {p.status === "voided" ? "已撤销" : ""}
              </span>
            )}
          </div>
        ))}
      </div>

      {message && (
        <p className={`mt-3 text-sm ${payState?.ok || voidState?.ok ? "text-green-600" : "text-red-600"}`}>
          {message}
        </p>
      )}
    </div>
  );
}
