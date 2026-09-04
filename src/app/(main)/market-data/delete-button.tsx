"use client";

import { useActionState } from "react";
import { deleteCuPriceAction, type FormState } from "./actions";

export function DeleteCuPriceButton({ id }: { id: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(deleteCuPriceAction, null);

  return (
    <div className="space-y-1">
      <form action={action}>
        <input type="hidden" name="id" value={id} />
        <button
          type="submit"
          disabled={pending}
          className="text-xs text-red-600 hover:underline disabled:opacity-50"
        >
          删除
        </button>
      </form>
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state?.ok && <p className="text-xs text-green-600">{state.ok}</p>}
    </div>
  );
}
