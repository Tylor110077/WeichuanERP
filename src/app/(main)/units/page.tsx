import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { MasterDataManager } from "@/components/master-data-manager";
import {
  deleteUnitAction,
  saveUnitAction,
  toggleUnitStatusAction,
} from "./actions";

export const metadata = { title: "单位字典 - 维川进销存" };

export default async function UnitsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const units = await prisma.unit.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, status: true },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-gray-900">单位字典</h1>
      <MasterDataManager
        entityLabel="单位"
        columns={[{ key: "name", label: "单位名称" }]}
        fields={[
          {
            name: "name",
            label: "单位名称",
            required: true,
            maxLength: 20,
            placeholder: "如：米、卷、箱、件、个、吨",
          },
        ]}
        rows={units.map((u) => ({
          id: u.id,
          status: u.status,
          cells: { name: u.name },
          formValues: { name: u.name },
        }))}
        isAdmin={user.role === "admin"}
        saveAction={saveUnitAction}
        toggleAction={toggleUnitStatusAction}
        deleteAction={deleteUnitAction}
      />
    </div>
  );
}
