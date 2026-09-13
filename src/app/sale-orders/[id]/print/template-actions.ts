"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { writeAudit } from "@/lib/audit";
import { PRINT_TEMPLATE_KIND, parsePrintTemplateConfig, type PrintTemplateConfig } from "@/lib/print-template";

/**
 * 打印模板的增删改。模板是"全店共用的一套版式"，所以只有管理员能改；
 * 其它角色照样能在打印页选择并使用模板。
 */
export type TemplateActionResult = { ok?: string; error?: string; id?: number } | null;

export async function savePrintTemplateAction(input: {
  id?: number;
  name: string;
  config: PrintTemplateConfig;
  /** 存完设为本类默认（下次打开打印页自动套用） */
  isDefault?: boolean;
}): Promise<TemplateActionResult> {
  const admin = await requireAdmin().catch(() => null);
  if (!admin) return { error: "仅管理员可保存打印模板" };

  const name = input.name.trim().slice(0, 50);
  if (!name) return { error: "请填写模板名称" };
  const kind = PRINT_TEMPLATE_KIND;
  const config = parsePrintTemplateConfig(input.config);

  const saved = await prisma.$transaction(async (tx) => {
    // 同类里只留一个默认
    if (input.isDefault) {
      await tx.printTemplate.updateMany({ where: { kind }, data: { isDefault: false } });
    }
    if (input.id) {
      return tx.printTemplate.update({
        where: { id: input.id },
        data: { name, kind, config, ...(input.isDefault ? { isDefault: true } : {}) },
        select: { id: true, name: true, isDefault: true },
      });
    }
    return tx.printTemplate.create({
      data: { name, kind, config, isDefault: !!input.isDefault, operatorId: admin.id },
      select: { id: true, name: true, isDefault: true },
    });
  });

  await writeAudit({
    userId: admin.id,
    action: input.id ? "update" : "create",
    entityType: "print_template",
    entityId: saved.id,
    after: { name: saved.name, isDefault: saved.isDefault },
  });
  // 打印页在 /sale-orders/[id]/print 下，按单据 id 逐个 revalidate 不现实，按布局整片刷新
  revalidatePath("/sale-orders", "layout");
  return { ok: input.id ? `已保存到模板「${name}」` : `已新建模板「${name}」`, id: saved.id };
}

export async function deletePrintTemplateAction(id: number): Promise<TemplateActionResult> {
  const admin = await requireAdmin().catch(() => null);
  if (!admin) return { error: "仅管理员可删除打印模板" };

  const found = await prisma.printTemplate.findUnique({ where: { id }, select: { name: true, isDefault: true } });
  if (!found) return { error: "模板不存在" };

  await prisma.printTemplate.delete({ where: { id } });
  await writeAudit({
    userId: admin.id,
    action: "delete",
    entityType: "print_template",
    entityId: id,
    before: { name: found.name, isDefault: found.isDefault },
  });
  revalidatePath("/sale-orders", "layout");
  return { ok: `已删除模板「${found.name}」` };
}

export async function setDefaultPrintTemplateAction(id: number): Promise<TemplateActionResult> {
  const admin = await requireAdmin().catch(() => null);
  if (!admin) return { error: "仅管理员可设置默认模板" };

  const found = await prisma.printTemplate.findUnique({ where: { id }, select: { name: true, kind: true } });
  if (!found) return { error: "模板不存在" };

  await prisma.$transaction(async (tx) => {
    await tx.printTemplate.updateMany({ where: { kind: found.kind }, data: { isDefault: false } });
    await tx.printTemplate.update({ where: { id }, data: { isDefault: true } });
  });
  await writeAudit({
    userId: admin.id,
    action: "update",
    entityType: "print_template",
    entityId: id,
    after: { name: found.name, isDefault: true },
  });
  revalidatePath("/sale-orders", "layout");
  return { ok: `已把「${found.name}」设为默认模板` };
}
