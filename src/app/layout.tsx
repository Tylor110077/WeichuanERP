import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "玮川进销存",
  description: "企业进销存管理系统（进货/销售/库存/往来/报表）",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-CN"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
