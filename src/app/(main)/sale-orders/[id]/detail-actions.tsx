"use client";

import { useActionState, useState } from "react";
import { btnDanger, btnDangerSolid, btnSecondary, inputBase } from "@/lib/ui";
import { voidSaleOrderAction, type FormState } from "../actions";
import { FormStateAlert } from "@/components/form-alert";

export function DetailActions({ orderId, status }: { orderId: number; status: string }) {
  const [showVoidInput, setShowVoidInput] = useState(false);
  const [voidState, voidAction, voidPending] = useActionState<FormState, FormData>(
    voidSaleOrderAction,
    null
  );

  if (status === "voided") return null;

  return (
    <>
      <div className="flex items-center gap-3">
        {!showVoidInput && (
          <button
            type="button"
            onClick={() => setShowVoidInput((v) => !v)}
            className={btnDanger}
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
            className={`${inputBase} w-96`}
          />
          <button
            type="submit"
            disabled={voidPending}
            className={btnDangerSolid}
          >
            {voidPending ? "处理中…" : "确认作废"}
          </button>
          <button
            type="button"
            onClick={() => setShowVoidInput(false)}
            className={btnSecondary}
          >
            取消
          </button>
        </form>
      )}
      <FormStateAlert state={voidState} className="basis-full" />
    </>
  );
}
