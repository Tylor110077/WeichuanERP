"use client";

import { useState, useTransition } from "react";
import { fetchCuPriceNowAction } from "./actions";

export function FetchButton() {
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const res = await fetchCuPriceNowAction();
      setMsg(res?.ok ? { ok: res.ok } : { error: res?.error ?? "抓取失败" });
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-md border border-blue-300 px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50 disabled:opacity-50"
      >
        {pending ? "抓取中…" : "立即抓取网络行情"}
      </button>
      {msg?.ok && <span className="text-xs text-green-600">{msg.ok}</span>}
      {msg?.error && <span className="text-xs text-red-600">{msg.error}</span>}
    </div>
  );
}
