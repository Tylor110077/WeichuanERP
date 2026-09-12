"use client";

import { useActionState, useState } from "react";
import { btnDanger, btnDangerSolid, btnSecondary, btnSuccess, inputBase } from "@/lib/ui";
import {
  receivePurchaseOrderAction,
  voidPurchaseOrderAction,
  type FormState,
} from "../actions";
import { FormAlert } from "@/components/form-alert";

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
    <>
      <div className="flex items-center gap-3">
        {status === "pending" && canReceive && (
          <form action={receiveAction}>
            <input type="hidden" name="id" value={orderId} />
            <button
              type="submit"
              disabled={receivePending}
              className={btnSuccess}
            >
              {receivePending ? "入库中…" : "确认入库"}
            </button>
          </form>
        )}
        {status !== "voided" && canVoid && (
          <button
            type="button"
            onClick={() => setShowVoidInput((v) => !v)}
            className={btnDanger}
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
            className={`${inputBase} w-64`}
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

      {/* 提示独占一行：作为表头 flex 行的 basis-full 子项，换行显示在整行按钮之下，
          不会参与按钮的垂直对齐（此前提示与按钮同列，按钮被按中线对齐而错位） */}
      {receiveMsg && (
        <FormAlert
          kind={receiveState?.ok ? "ok" : "error"}
          text={receiveMsg}
          className="basis-full"
        />
      )}
      {voidMsg && (
        <FormAlert kind={voidState?.ok ? "ok" : "error"} text={voidMsg} className="basis-full" />
      )}
    </>
  );
}
