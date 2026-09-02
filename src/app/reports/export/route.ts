import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/auth/session";
import { buildReport, REPORT_TABS, type ReportTabKey } from "@/lib/reports";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (user.role === "sales") return new Response("Forbidden", { status: 403 });

  const sp = request.nextUrl.searchParams;
  const tabRaw = sp.get("tab") ?? "summary";
  if (!REPORT_TABS.some((t) => t.key === tabRaw)) {
    return new Response("Bad Request", { status: 400 });
  }
  const tab = tabRaw as ReportTabKey;
  const from = sp.get("from") ?? undefined;
  const to = sp.get("to") ?? undefined;

  const result = await buildReport(tab, from, to);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(result.title);
  sheet.columns = result.columns.map((c) => ({
    header: c.label,
    key: c.key,
    width: Math.max(12, c.label.length * 2 + 4),
  }));
  sheet.getRow(1).font = { bold: true };
  for (const row of result.rows) {
    sheet.addRow(row);
  }

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const fromStr = tab === "inventory" ? "" : from ?? "";
  const fileName = encodeURIComponent(`${result.title}${fromStr ? `-${fromStr}` : ""}.xlsx`);
  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${fileName}`,
      "Cache-Control": "no-store",
    },
  });
}
