"use client";

import { useTransition } from "react";

/**
 * 星标开关：点一下即切换（不做二次确认——星标不是破坏性操作，误点再点一次就好）。
 *
 * server action 由调用方传进来（售卖单一套、进货单一套），组件本身对两种单据一视同仁。
 */
export function StarToggle({
  id,
  starred,
  toggle,
  className = "",
}: {
  id: number;
  starred: boolean;
  toggle: (formData: FormData) => Promise<void>;
  /** 尺寸等附加样式（列表行里小一点） */
  className?: string;
}) {
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={starred}
      aria-label={starred ? "取消星标" : "加星标"}
      title={starred ? "取消星标" : "加星标"}
      onClick={() =>
        start(async () => {
          const fd = new FormData();
          fd.set("id", String(id));
          fd.set("starred", starred ? "0" : "1");
          await toggle(fd);
        })
      }
      className={`shrink-0 rounded px-0.5 leading-none transition disabled:opacity-40 ${
        starred ? "text-amber-500 hover:text-amber-600" : "text-gray-300 hover:text-amber-500"
      } ${className}`}
    >
      {starred ? "★" : "☆"}
    </button>
  );
}
