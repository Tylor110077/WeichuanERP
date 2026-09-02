"use client";

import { useActionState, useState } from "react";
import { voidPurchaseReturnAction, type FormState } from "./actions";

export function ReturnListActions({ id, status }: { id: number; status: string }) {
  const [showInput, setShowInput] = useState(false);
  const [state, action, pending] = useActionState<FormState, FormData>(
    voidPurchaseReturnAction,
    null
  );

  if (status === "voided") {
    return <span className="text-xs text-gray-400">已作废</span>;
  }

  return (
    <div className="space-y-1">
      {!showInput && (
        <button
          type="button"
          onClick={() => setShowInput(true)}
          className="text-xs text-red-600 hover:underline"
        >
          作废
        </button>
      )}
      {showInput && (
        <form action={action} className="flex flex-col gap-1">
          <input type="hidden" name="id" value={id} />
          <input
            name="reason"
            type="text"
            required
            maxLength={200}
            placeholder="作废原因（必填）"
            className="w-48 rounded border border-gray-300 px-1.5 py-0.5 text-xs"
          />
          <div className="flex gap-1">
            <button
              type="submit"
              disabled={pending}
              className="rounded bg-red-600 px-2 py-0.5 text-xs text-white hover:bg-red-700 disabled:opacity-50"
            >
              {pending ? "处理中…" : "确认"}
            </button>
            <button
              type="button"
              onClick={() => setShowInput(false)}
              className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
            >
              取消
            </button>
          </div>
        </form>
      )}
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state?.ok && <p className="text-xs text-green-600">{state.ok}</p>}
    </div>
  );
}
