/**
 * 打印模板：一套模板 = 打印页上那些"与单据无关"的版式设置
 * （打印方式、列显隐、显示选项、收款账户、抬头与页脚）。
 * 与单据相关的内容（客户、商品行、金额、日期）不进模板。
 */

export const PRINT_MODES = ["carbon", "a4-three", "a4-pages"] as const;
export type PrintModeKey = (typeof PRINT_MODES)[number];

export interface PrintTemplateConfig {
  printMode: PrintModeKey;
  /** 存"隐藏了哪些列"而不是"显示哪些"：将来新增列默认显示，不会因为旧模板而消失 */
  hiddenCols: string[];
  showRmb: boolean;
  showSign: boolean;
  account: string;
  title: string;
  company: string;
  address: string;
  phone: string;
}

export const PRINT_TEMPLATE_DEFAULTS: PrintTemplateConfig = {
  printMode: "carbon",
  hiddenCols: ["idx", "remark"],
  showRmb: true,
  showSign: true,
  account: "",
  title: "销售单",
  company: "重庆鑫玮川物资有限公司",
  address: "",
  phone: "",
};

/** 目前只做售卖单；进货单将来可复用同一张表（kind 区分） */
export const PRINT_TEMPLATE_KIND = "sale";

/** 从库里读出来的 JSON 宽容解析：缺项用默认值，坏数据不至于让打印页打不开 */
export function parsePrintTemplateConfig(raw: unknown): PrintTemplateConfig {
  const o = (raw ?? {}) as Partial<PrintTemplateConfig>;
  return {
    printMode: PRINT_MODES.includes(o.printMode as PrintModeKey)
      ? (o.printMode as PrintModeKey)
      : PRINT_TEMPLATE_DEFAULTS.printMode,
    hiddenCols: Array.isArray(o.hiddenCols)
      ? o.hiddenCols.filter((c): c is string => typeof c === "string")
      : PRINT_TEMPLATE_DEFAULTS.hiddenCols,
    showRmb: typeof o.showRmb === "boolean" ? o.showRmb : PRINT_TEMPLATE_DEFAULTS.showRmb,
    showSign: typeof o.showSign === "boolean" ? o.showSign : PRINT_TEMPLATE_DEFAULTS.showSign,
    account: typeof o.account === "string" ? o.account : "",
    title: typeof o.title === "string" && o.title.trim() ? o.title : PRINT_TEMPLATE_DEFAULTS.title,
    company: typeof o.company === "string" && o.company.trim() ? o.company : PRINT_TEMPLATE_DEFAULTS.company,
    address: typeof o.address === "string" ? o.address : "",
    phone: typeof o.phone === "string" ? o.phone : "",
  };
}

/** 传给客户端的模板（已解析成纯数据） */
export interface PrintTemplateDTO {
  id: number;
  name: string;
  isDefault: boolean;
  config: PrintTemplateConfig;
}
