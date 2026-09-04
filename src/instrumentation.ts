/**
 * 应用内定时任务（生产环境生效）：
 * 每 30 分钟尝试自动抓取当日沪铜主力行情并写入（幂等 upsert），失败静默（人工录入兜底）。
 * 仅生产启用；Docker 单实例下运行稳定。
 */
export async function register() {
  if (process.env.NODE_ENV !== "production") return;
  const { fetchCuPriceOnce } = await import("@/lib/cu-price-fetch");
  const { PrismaClient } = await import("@prisma/client");

  const run = async () => {
    try {
      const data = await fetchCuPriceOnce();
      if (!data) return;
      const prisma = new PrismaClient();
      try {
        const date = new Date(`${data.priceDate}T00:00:00`);
        await prisma.cuPrice.upsert({
          where: { priceDate: date },
          update: { price: data.price },
          create: { priceDate: date, price: data.price },
        });
      } finally {
        await prisma.$disconnect();
      }
    } catch {
      // 静默失败，人工录入兜底
    }
  };

  const timer = setInterval(run, 30 * 60 * 1000);
  // 部署/启动后先跑一次
  setTimeout(run, 10 * 1000);
  // 保持进程（Next 服务器进程生命周期内常驻）
  (globalThis as unknown as { __cuPriceTimer?: NodeJS.Timeout }).__cuPriceTimer = timer;
}
