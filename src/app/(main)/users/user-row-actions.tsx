"use client";

import { useActionState, useState } from "react";
import {
  resetPasswordAction,
  toggleUserStatusAction,
  type FormState,
} from "./actions";

interface Props {
  userId: number;
  status: number;
  isSelf: boolean;
}

export function UserRowActions({ userId, status, isSelf }: Props) {
  const [showReset, setShowReset] = useState(false);
  const [resetState, resetAction, resetPending] = useActionState<FormState, FormData>(
    resetPasswordAction,
    null
  );
  const [toggleState, toggleAction, togglePending] = useActionState<FormState, FormData>(
    toggleUserStatusAction,
    null
  );

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        {!isSelf && (
          <form action={toggleAction}>
            <input type="hidden" name="userId" value={userId} />
            <button
              type="submit"
              disabled={togglePending}
              className="text-xs text-red-600 hover:underline disabled:opacity-50"
            >
              {status === 1 ? "停用" : "启用"}
            </button>
          </form>
        )}
        <button
          type="button"
          onClick={() => setShowReset((v) => !v)}
          className="text-xs text-blue-600 hover:underline"
        >
          重置密码
        </button>
      </div>

      {showReset && (
        <form action={resetAction} className="flex gap-1">
          <input type="hidden" name="userId" value={userId} />
          <input
            name="newPassword"
            type="password"
            placeholder="新密码（≥8位含字母数字）"
            required
            minLength={8}
            maxLength={100}
            className="w-40 rounded border border-gray-300 px-1.5 py-0.5 text-xs"
          />
          <button
            type="submit"
            disabled={resetPending}
            className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-200 disabled:opacity-50"
          >
            确定
          </button>
        </form>
      )}

      {resetState?.error && (
        <p className="text-xs text-red-600">{resetState.error}</p>
      )}
      {resetState?.ok && <p className="text-xs text-green-600">{resetState.ok}</p>}
      {toggleState?.error && (
        <p className="text-xs text-red-600">{toggleState.error}</p>
      )}
      {toggleState?.ok && <p className="text-xs text-green-600">{toggleState.ok}</p>}
    </div>
  );
}
