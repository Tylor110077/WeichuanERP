import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { backupStream } from "@/lib/backup";

/** 下载某个备份包（仅管理员） */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return new NextResponse("无权限", { status: 403 });
  }
  const file = new URL(request.url).searchParams.get("file");
  if (!file || file.includes("/") || file.includes("..")) {
    return new NextResponse("文件名不合法", { status: 400 });
  }
  try {
    const stream = await backupStream(file);
    return new NextResponse(stream as unknown as ReadableStream, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${file}"`,
      },
    });
  } catch {
    return new NextResponse("备份文件不存在", { status: 404 });
  }
}
