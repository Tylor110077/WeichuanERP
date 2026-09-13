"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { btnDanger, btnDangerSolid, btnSecondary, btnSuccess, btnWarn, inputBase } from "@/lib/ui";
import { receivePurchaseOrderAction, voidPurchaseOrderAction, type FormState } from "../actions";
import { FormStateAlert } from "@/components/form-alert";

/**
 * 进货单详情页右上角的操作区。
 *
 * 排序：确认入库（本单最常做的下一步）→ 改单 → 退货 → 作废（破坏性递增）；
 * 「← 返回列表」只是导航，弱化成文字链接放最右。确认表单与提示 basis-full 独占一行，
 * 点开时只在下方展开，不会挤动上面那排按钮。
 */
export function DetailActions({
  orderId,
  status,
  canReceive,
  canVoid,
  canReturn,
  returnCreateHref,
  returnHref,
}: {
  orderId: number;
  status: string;
  canReceive: boolean;
  canVoid: boolean;
  canReturn: boolean;
  /** 发起退货的开单页地址 */
  returnCreateHref: string;
  returnHref: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState<"none" | "void" | "reopen">("none");
  /** 本次提交是为了改单（作废成功后跳开单页），与普通作废区分开 */
  const [reopenIntent, setReopenIntent] = useState(false);
  const [receiveState, receiveAction, receivePending] = useActionState<FormState, FormData>(
    receivePurchaseOrderAction,
    null
  );
  const [voidState, voidAction, voidPending] = useActionState<FormState, FormData>(
    voidPurchaseOrderAction,
    null
  );

  useEffect(() => {
    if (reopenIntent && voidState?.ok) {
      router.push(`/purchase-orders/new?fromOrder=${orderId}`);
    }
  }, [reopenIntent, voidState, router, orderId]);

  const voided = status === "voided";

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {status === "pending" && canReceive && (
          <form action={receiveAction}>
            <input type="hidden" name="id" value={orderId} />
            <button type="submit" disabled={receivePending} className={btnSuccess}>
              {receivePending ? "入库中…" : "确认入库"}
            </button>
          </form>
        )}
        {!voided && canVoid && (
          <button type="button" onClick={() => setForm((f) => (f === "reopen" ? "none" : "reopen"))} className={btnWarn}>
            改单
          </button>
        )}
        {!voided && canReturn && (
          <Link href={returnCreateHref} className={btnWarn}>
            退货
          </Link>
        )}
        {!voided && canVoid && (
          <button type="button" onClick={() => setForm((f) => (f === "void" ? "none" : "void"))} className={btnDanger}>
            作废
          </button>
        )}
        {!canReceive && !canVoid && !canReturn && (
          <span className="text-xs text-gray-400">只读</span>
        )}
        {/* 导航不跟操作并列：弱化成文字链接 */}
        <Link href={returnHref} className="ml-2 text-xs text-gray-500 hover:underline">
          ← 返回列表
        </Link>
      </div>

      {form === "reopen" && (
        <form
          action={voidAction}
          onSubmit={() => setReopenIntent(true)}
          className="flex basis-full flex-wrap items-start gap-2"
        >
          <input type="hidden" name="id" value={orderId} />
          <input
            name="reason"
            type="text"
            required
            maxLength={200}
            defaultValue="改单"
            placeholder="改单原因（必填）"
            className={`${inputBase} w-96`}
          />
          <button type="submit" disabled={voidPending} className={btnWarn}>
            {voidPending ? "处理中…" : "作废并去改"}
          </button>
          <button type="button" onClick={() => setForm("none")} className={btnSecondary}>
            取消
          </button>
        </form>
      )}
      {form === "void" && (
        <form action={voidAction} className="flex basis-full flex-wrap items-start gap-2">
          <input type="hidden" name="id" value={orderId} />
          <input
            name="reason"
            type="text"
            required
            maxLength={200}
            placeholder="作废原因（必填），已入库的会同时冲回库存"
            className={`${inputBase} w-96`}
          />
          <button type="submit" disabled={voidPending} className={btnDangerSolid}>
            {voidPending ? "处理中…" : "确认作废"}
          </button>
          <button type="button" onClick={() => setForm("none")} className={btnSecondary}>
            取消
          </button>
        </form>
      )}
      <FormStateAlert state={receiveState ?? voidState} className="basis-full" />
    </>
  );
}
