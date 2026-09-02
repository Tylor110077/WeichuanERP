"use client";

import { useActionState, useState } from "react";
import {
  receivePurchaseOrderAction,
  voidPurchaseOrderAction,
  type FormState,
} from "../actions";

export function DetailActions({
  orderId,
  status,
  canReceive,
  canVoid,
}: {
  orderId: number;
  status: string;
  canReceive: boolean;
  canVoid: boolean;
}) {
  const [showVoidInput, setShowVoidInput] = useState(false);
  const [receiveState, receiveAction, receivePending] = useActionState<FormState, FormData>(
    receivePurchaseOrderAction,
    null
  );
  const [voidState, voidAction, voidPending] = useActionState<FormState, FormData>(
    voidPurchaseOrderAction,
    null
  );

  const receiveMsg = receiveState?.error ?? receiveState?.ok;
  const voidMsg = voidState?.error ?? voidState?.ok;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        {status === "pending" && canReceive && (
          <form action={receiveAction}>
            <input type="hidden" name="id" value={orderId} />
            <button
              type="submit"
              disabled={receivePending}
              className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {receivePending ? "入库中…" : "确认入库"}
            </button>
          </form>
        )}
        {status !== "voided" && canVoid && (
          <button
            type="button"
            onClick={() => setShowVoidInput((v) => !v)}
            className="rounded-md border border-red-300 px-4 py-1.5 text-sm text-red-600 hover:bg-red-50"
          >
            作废
          </button>
        )}
        {!canReceive && !canVoid && (
          <span className="text-xs text-gray-400">只读</span>
        )}
      </div>

      {showVoidInput && (
        <form action={voidAction} className="flex items-start gap-2">
          <input type="hidden" name="id" value={orderId} />
          <input
            name="reason"
            type="text"
            required
            maxLength={200}
            placeholder="作废原因（必填）"
            className="w-64 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={voidPending}
            className="rounded-md bg-red-600 px-4 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50"
          >
            {voidPending ? "处理中…" : "确认作废"}
          </button>
          <button
            type="button"
            onClick={() => setShowVoidInput(false)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
          >
            取消
          </button>
        </form>
      )}

      {receiveMsg && (
        <p className={`text-sm ${receiveState?.ok ? "text-green-600" : "text-red-600"}`}>
          {receiveMsg}
        </p>
      )}
      {voidMsg && (
        <p className={`text-sm ${voidState?.ok ? "text-green-600" : "text-red-600"}`}>
          {voidMsg}
        </p>
      )}
    </div>
  );
}
