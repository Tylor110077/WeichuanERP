"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { btnDanger, btnDangerSolid, btnSecondary, btnWarn, inputBase } from "@/lib/ui";
import { voidSaleOrderAction, type FormState } from "../actions";
import { FormStateAlert } from "@/components/form-alert";

/**
 * 单据详情页的操作：改单 / 作废。
 *
 * 「改单」= 作废原单 + 跳到开单页并把原单内容带过去。原单已经动过库存与移动加权成本，
 * 回头就地修改会把它之后所有单据的成本带偏，所以只能整单作废重开；
 * 这里只是把"作废 → 重录"两步并成一步，数据一致性仍由既有的作废逻辑保证。
 */
export function DetailActions({ orderId, status }: { orderId: number; status: string }) {
  const router = useRouter();
  const [showVoidInput, setShowVoidInput] = useState(false);
  const [showReopenInput, setShowReopenInput] = useState(false);
  /** 本次提交是为了改单（作废成功后跳开单页），与普通作废区分开 */
  const [reopenIntent, setReopenIntent] = useState(false);
  const [voidState, voidAction, voidPending] = useActionState<FormState, FormData>(
    voidSaleOrderAction,
    null
  );

  useEffect(() => {
    if (reopenIntent && voidState?.ok) {
      router.push(`/sale-orders/new?fromOrder=${orderId}`);
    }
  }, [reopenIntent, voidState, router, orderId]);

  if (status === "voided") return null;

  return (
    <>
      <div className="flex items-center gap-3">
        {!showVoidInput && !showReopenInput && (
          <>
            <button
              type="button"
              onClick={() => setShowReopenInput(true)}
              title="作废原单，并把原单内容带到开单页去改（库存与成本会重新计算）"
              className={btnWarn}
            >
              改单
            </button>
            <button
              type="button"
              onClick={() => setShowVoidInput((v) => !v)}
              className={btnDanger}
            >
              作废
            </button>
          </>
        )}
      </div>
      {showReopenInput && (
        <form action={voidAction} onSubmit={() => setReopenIntent(true)} className="flex items-start gap-2">
          <input type="hidden" name="id" value={orderId} />
          <input
            name="reason"
            type="text"
            required
            maxLength={200}
            defaultValue="改单"
            placeholder="改单原因（必填），随单自动补货单将一并作废"
            className={`${inputBase} w-96`}
          />
          <button type="submit" disabled={voidPending} className={btnWarn}>
            {voidPending ? "处理中…" : "作废并去改"}
          </button>
          <button type="button" onClick={() => setShowReopenInput(false)} className={btnSecondary}>
            取消
          </button>
        </form>
      )}
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
          <button type="submit" disabled={voidPending} className={btnDangerSolid}>
            {voidPending ? "处理中…" : "确认作废"}
          </button>
          <button type="button" onClick={() => setShowVoidInput(false)} className={btnSecondary}>
            取消
          </button>
        </form>
      )}
      <FormStateAlert state={voidState} className="basis-full" />
    </>
  );
}
