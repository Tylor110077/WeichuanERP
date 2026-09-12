"use client";

import { useActionState } from "react";
import { btnPrimary, btnSecondary, btnSmallPrimary, inputBase } from "@/lib/ui";
import { FormStateAlert } from "@/components/form-alert";
import {
  createBackupNowAction,
  deleteBackupAction,
  restoreBackupAction,
  saveBackupConfigAction,
  type BackupState,
} from "./actions";

function Alert({ state }: { state: BackupState }) {
  return <FormStateAlert state={state} compact />;
}

/** 立即备份 */
export function BackupNowButton() {
  const [state, action, pending] = useActionState<BackupState, FormData>(
    async () => createBackupNowAction(),
    null
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "备份中…" : "立即备份"}
      </button>
      <Alert state={state} />
    </form>
  );
}

/** 备份周期与保留份数 */
export function BackupConfigForm({ intervalHours, keep }: { intervalHours: number; keep: number }) {
  const [state, action, pending] = useActionState<BackupState, FormData>((_prev, formData) => saveBackupConfigAction(formData), null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor="intervalHours" className="block text-xs font-medium text-gray-600">
          备份周期（小时）
        </label>
        <input
          id="intervalHours"
          name="intervalHours"
          type="number"
          min={1}
          max={720}
          defaultValue={intervalHours}
          className={`${inputBase} mt-1 w-28`}
        />
      </div>
      <div>
        <label htmlFor="keep" className="block text-xs font-medium text-gray-600">
          保留最近几份
        </label>
        <input
          id="keep"
          name="keep"
          type="number"
          min={1}
          max={365}
          defaultValue={keep}
          className={`${inputBase} mt-1 w-28`}
        />
      </div>
      <button type="submit" disabled={pending} className={btnSecondary}>
        {pending ? "保存中…" : "保存"}
      </button>
      <Alert state={state} />
    </form>
  );
}

/** 删除某个备份 */
export function DeleteBackupForm({ file }: { file: string }) {
  const [state, action, pending] = useActionState<BackupState, FormData>((_prev, formData) => deleteBackupAction(formData), null);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="file" value={file} />
      <button type="submit" disabled={pending} className="text-xs text-red-600 hover:underline">
        删除
      </button>
      {state?.error && <span className="ml-1 text-xs text-red-600">{state.error}</span>}
    </form>
  );
}

/** 上传备份包恢复数据（覆盖式，必须勾选确认） */
export function RestoreForm() {
  const [state, action, pending] = useActionState<BackupState, FormData>((_prev, formData) => restoreBackupAction(formData), null);
  return (
    <form action={action} className="space-y-3">
      <input
        type="file"
        name="file"
        accept=".gz,application/gzip"
        required
        className="block w-full max-w-md rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm file:mr-3 file:rounded file:border-0 file:bg-gray-100 file:px-2 file:py-1 file:text-xs"
      />
      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input type="checkbox" name="confirm" value="yes" className="mt-1" />
        <span>
          我确认用这个压缩包<strong className="text-red-600">覆盖当前全部数据</strong>
          （系统会在覆盖前自动备份一次当前数据，作为退路）
        </span>
      </label>
      <button type="submit" disabled={pending} className={btnSmallPrimary}>
        {pending ? "恢复中…（数据量大时需要一会儿）" : "开始恢复"}
      </button>
      <Alert state={state} />
    </form>
  );
}
