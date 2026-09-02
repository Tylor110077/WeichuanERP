"use client";

import { useActionState, useEffect } from "react";
import { changePasswordAction, type FormState } from "./actions";

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    changePasswordAction,
    null
  );

  useEffect(() => {
    if (state?.ok) {
      const formEl = document.getElementById("change-password-form") as HTMLFormElement | null;
      formEl?.reset();
    }
  }, [state]);

  const fieldCls =
    "mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm";

  return (
    <form
      id="change-password-form"
      action={formAction}
      className="max-w-md space-y-4 rounded-xl border border-gray-200 bg-white p-5"
    >
      <div>
        <label htmlFor="currentPassword" className="block text-xs font-medium text-gray-600">
          当前密码
        </label>
        <input
          id="currentPassword"
          name="currentPassword"
          type="password"
          required
          autoComplete="current-password"
          className={fieldCls}
        />
      </div>
      <div>
        <label htmlFor="newPassword" className="block text-xs font-medium text-gray-600">
          新密码（≥8 位，含字母和数字）
        </label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={fieldCls}
        />
      </div>
      <div>
        <label htmlFor="confirmPassword" className="block text-xs font-medium text-gray-600">
          确认新密码
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={fieldCls}
        />
      </div>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.ok && <p className="text-sm text-green-600">{state.ok}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? "提交中…" : "修改密码"}
      </button>
    </form>
  );
}
