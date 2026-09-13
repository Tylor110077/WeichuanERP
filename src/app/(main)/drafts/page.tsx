import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { DraftBox } from "./draft-box";

export default async function DraftsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">开单草稿</h1>
        <p className="text-xs text-gray-400">
          开售卖单 / 进货单时自动保存，填到一半切走也不会丢；存在这台电脑的浏览器里，只有你自己看得到。
        </p>
      </div>
      <DraftBox userId={user.id} />
    </div>
  );
}
