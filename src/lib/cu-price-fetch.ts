/**
 * 铜价自动抓取（沪铜主力，元/吨）。
 * 数据源（免费、无密钥）：
 *  1) 新浪期货行情 hq.sinajs.cn/list=nf_CU0（GBK 编码，需 Referer）
 *  2) 备用：东方财富 push2 JSON 接口
 * 任一失败返回 null（调用方降级为人工录入，不抛错）。
 */

export interface FetchedCuPrice {
  priceDate: string; // yyyy-mm-dd
  price: number; // 元/吨
  source: "sina" | "eastmoney";
}

async function fetchSina(): Promise<FetchedCuPrice | null> {
  try {
    const res = await fetch("https://hq.sinajs.cn/list=nf_CU0", {
      headers: { Referer: "https://finance.sina.com.cn" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    let text = "";
    try {
      text = new TextDecoder("gbk").decode(buf);
    } catch {
      text = Buffer.from(buf).toString("latin1"); // 兜底（数字 ASCII 仍可解析）
    }
    // 形如: var hq_str_nf_CU0="沪铜主力,78500,..."  字段[1]=最新价
    const m = /="([^"]*)"/.exec(text);
    if (!m) return null;
    const parts = m[1].split(",");
    const price = Number(parts[1]);
    if (!Number.isFinite(price) || price <= 0) return null;
    const now = new Date();
    const priceDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return { priceDate, price, source: "sina" };
  } catch {
    return null;
  }
}

async function fetchEastmoney(): Promise<FetchedCuPrice | null> {
  try {
    // 东财 沪铜连续/主力 期货行情（secid：沪期所 113.cu? 尝试主连）
    const res = await fetch(
      "https://push2.eastmoney.com/api/qt/stock/get?secid=113.CU0&fields=f43,f44,f57,f58,f59&invt=2&fltt=1",
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { f43?: number; f57?: string; f58?: string } };
    const price = Number(json.data?.f43);
    if (!Number.isFinite(price) || price <= 0) return null;
    const name = json.data?.f58 ?? "沪铜";
    void name;
    const now = new Date();
    const priceDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return { priceDate, price, source: "eastmoney" };
  } catch {
    return null;
  }
}

export async function fetchCuPriceOnce(): Promise<FetchedCuPrice | null> {
  const sina = await fetchSina();
  if (sina) return sina;
  const em = await fetchEastmoney();
  if (em) return em;
  return null;
}
