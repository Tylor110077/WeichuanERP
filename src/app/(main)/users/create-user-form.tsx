"use client";
import { btnPrimary, inputBase, selectCls } from "@/lib/ui";

import { useActionState, useEffect } from "react";
import { createUserAction, type FormState } from "./actions";
import { FormStateAlert } from "@/components/form-alert";

export function CreateUserForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createUserAction,
    null
  );

  useEffect(() => {
    if (state?.ok) {
      // 成功后清空表单（列表由服务端 revalidatePath 刷新）
      const formEl = document.getElementById("create-user-form") as HTMLFormElement | null;
      formEl?.reset();
    }
  }, [state]);

  return (
    <form id="create-user-form" action={formAction} className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="mb-4 text-sm font-semibold text-gray-900">新建用户</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="username" className="block text-xs font-medium text-gray-600">
            账号
          </label>
          <input
            id="username"
            name="username"
            type="text"
            required
            maxLength={50}
            className={`${inputBase} mt-1 w-full`}
          />
        </div>
        <div>
          <label htmlFor="displayName" className="block text-xs font-medium text-gray-600">
            姓名
          </label>
          <input
            id="displayName"
            name="displayName"
            type="text"
            required
            maxLength={50}
            className={`${inputBase} mt-1 w-full`}
          />
        </div>
        <div>
          <label htmlFor="role" className="block text-xs font-medium text-gray-600">
            角色
          </label>
          <select
            id="role"
            name="role"
            required
            className={`${selectCls} mt-1 w-full`}
          >
            <option value="sales">业务员</option>
            <option value="boss">老板/财务</option>
            <option value="admin">管理员</option>
          </select>
        </div>
        <div>
          <label htmlFor="password" className="block text-xs font-medium text-gray-600">
            初始密码（≥8 位，含字母和数字）
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            maxLength={100}
            className={`${inputBase} mt-1 w-full`}
          />
        </div>
      </div>
      <div className="mt-3 space-y-1">
        <FormStateAlert state={state} compact />
      </div>
      <button
        type="submit"
        disabled={pending}
        className={`mt-3 ${btnPrimary}`}
      >
        {pending ? "创建中…" : "创建用户"}
      </button>
    </form>
  );
}
