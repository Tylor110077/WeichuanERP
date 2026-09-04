"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireMasterDataWrite } from "@/lib/auth/guards";
import { writeAudit } from "@/lib/audit";
import { fetchCuPriceOnce } from "@/lib/cu-price-fetch";

const pointSchema = z.object({
  time: z.string().trim().min(1).max(5),
  price: z.coerce.number().min(0).max(9_999_999),
});

const cuPriceSchema = z.object({
  priceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式不正确"),
  price: z.coerce.number().min(0, "价格不能为负").max(9_999_999),
  points: z.array(pointSchema).max(24),
});

export type FormState = { error?: string; ok?: string } | null;

export async function saveCuPriceAction(data: {
  priceDate: string;
  price: number;
  points: { time: string; price: number }[];
}): Promise<FormState> {
  const admin = await requireMasterDataWrite().catch(() => null);
  if (!admin) return { error: "无权限维护行情" };

  const parsed = cuPriceSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "输入有误" };

  const date = new Date(`${parsed.data.priceDate}T00:00:00`);
  const points = parsed.data.points
    .filter((p) => p.time && p.price >= 0)
    .sort((a, b) => (a.time < b.time ? -1 : 1));

  await prisma.cuPrice.upsert({
    where: { priceDate: date },
    update: {
      price: parsed.data.price,
      intraday: points.length > 0 ? (points as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
    },
    create: {
      priceDate: date,
      price: parsed.data.price,
      intraday: points.length > 0 ? (points as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
    },
  });

  await writeAudit({
    userId: admin.id,
    action: "update",
    entityType: "cu_price",
    after: { priceDate: parsed.data.priceDate, price: parsed.data.price, points: points.length },
  });
  revalidatePath("/market-data");
  revalidatePath("/dashboard");
  return { ok: `已保存 ${parsed.data.priceDate} 铜价 ¥${parsed.data.price}` };
}

export async function deleteCuPriceAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const admin = await requireMasterDataWrite().catch(() => null);
  if (!admin) return { error: "无权限维护行情" };
  const id = Number(formData.get("id"));
  const row = await prisma.cuPrice.findUnique({ where: { id } });
  if (!row) return { error: "记录不存在" };
  await prisma.cuPrice.delete({ where: { id } });
  await writeAudit({
    userId: admin.id,
    action: "delete",
    entityType: "cu_price",
    entityId: id,
    before: { priceDate: row.priceDate.toISOString().slice(0, 10), price: Number(row.price) },
  });
  revalidatePath("/market-data");
  revalidatePath("/dashboard");
  return { ok: "已删除" };
}


/** 手动抓取网络行情（管理员）；成功后写入当日行情。 */
export async function fetchCuPriceNowAction(): Promise<FormState> {
  const admin = await requireMasterDataWrite().catch(() => null);
  if (!admin) return { error: "无权限维护行情" };
  const fetched = await fetchCuPriceOnce();
  if (!fetched) {
    return { error: "自动抓取失败（网络不可用或数据源无响应），请人工录入" };
  }
  const date = new Date(`${fetched.priceDate}T00:00:00`);
  await prisma.cuPrice.upsert({
    where: { priceDate: date },
    update: { price: fetched.price },
    create: { priceDate: date, price: fetched.price },
  });
  await writeAudit({
    userId: admin.id,
    action: "update",
    entityType: "cu_price",
    after: { priceDate: fetched.priceDate, price: fetched.price, source: fetched.source, auto: true },
  });
  revalidatePath("/market-data");
  revalidatePath("/dashboard");
  return { ok: `已抓取 ${fetched.priceDate} 沪铜主力 ¥${fetched.price}（${fetched.source}）` };
}
