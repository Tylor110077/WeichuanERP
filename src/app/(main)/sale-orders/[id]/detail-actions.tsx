"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { btnDanger, btnDangerSolid, btnSecondary, btnWarn, inputBase } from "@/lib/ui";
import { voidSaleOrderAction, type FormState } from "../actions";
import { FormAlert } from "@/components/form-alert";

/**
 * 售卖单详情页右上角的操作区。
 *
 * 排序按"破坏性递增"：打印（只输出）→ 改单（作废重开）→ 退货（部分冲减）→ 作废（整单冲回），
 * 「← 返回列表」不参与操作、只是导航，单独放在最右且用弱样式，不跟操作抢视线。
 * 确认表单用 basis-full 独占一行：点开时只在下方展开，不会把上面一排按钮挤走。
 * 反馈提示则**就地放在这一排末尾**（compact）：它出现时不会新增一行、也不会把下面的内容推下去。
 */
export function DetailActions({
  orderId,
  status,
  printHref,
  canReturn,
  returnCreateHref,
  returnHref,
  canVoid,
}: {
  orderId: number;
  status: string;
  /** 打印入口（没有就不显示） */
  printHref?: string;
  canReturn: boolean;
  /** 发起退货的开单页地址 */
  returnCreateHref: string;
  returnHref: string;
  /** 改单与作废的权限（业务员没有） */
  canVoid: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<"none" | "void" | "reopen">("none");
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

  const voided = status === "voided";

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {printHref && (
          <a href={printHref} target="_blank" rel="noopener" className={btnSecondary}>
            打印销售单
          </a>
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
        {/* 导航不跟操作并列：弱化成文字链接，并留出一点间隔 */}
        <Link href={returnHref} className="ml-2 text-xs text-gray-500 hover:underline">
          ← 返回列表
        </Link>
        {/* 只显示错误，不显示成功：成功时页面自己会变（状态角标改成「已作废/已入库」、按钮消失），
            再补一条绿字只是噪音，而且它一出现就占地方。错误必须留——里面常带下一步该怎么做 */}
        {voidState?.error && <FormAlert kind="error" text={voidState.error} compact className="ml-1" />}
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
            placeholder="改单原因（必填），随单自动补货单将一并作废"
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
            placeholder="作废原因（必填），随单自动补货单将一并作废"
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
    </>
  );
}
