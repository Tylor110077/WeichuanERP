import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata = { title: "登录 - 玮川进销存" };

export default async function LoginPage() {
  if (await getCurrentUser()) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-center text-xl font-semibold text-gray-900">
          玮川进销存
        </h1>
        <p className="mb-6 text-center text-sm text-gray-500">
          请使用企业账号登录
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
