"use client";

import { useActionState, useState } from "react";
import { voidSaleOrderAction, type FormState } from "../actions";

export function DetailActions({ orderId, status }: { orderId: number; status: string }) {
  const [showVoidInput, setShowVoidInput] = useState(false);
  const [voidState, voidAction, voidPending] = useActionState<FormState, FormData>(
    voidSaleOrderAction,
    null
  );

  if (status === "voided") return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        {!showVoidInput && (
          <button
            type="button"
            onClick={() => setShowVoidInput((v) => !v)}
            className="rounded-md border border-red-300 px-4 py-1.5 text-sm text-red-600 hover:bg-red-50"
          >
            作废
          </button>
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
            placeholder="作废原因（必填），随单自动补货单将一并作废"
            className="w-96 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
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
      {voidState?.error && <p className="text-sm text-red-600">{voidState.error}</p>}
      {voidState?.ok && <p className="text-sm text-green-600">{voidState.ok}</p>}
    </div>
  );
}
