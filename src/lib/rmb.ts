/** 金额中文大写（元角分，供单据打印）。 */

const DIGITS = "零壹贰叁肆伍陆柒捌玖";
const SMALL_UNITS = ["拾", "佰", "仟"];
const BIG_UNITS = ["", "万", "亿", "兆"];

function intToUpper(num: number): string {
  if (num === 0) return "零";
  let result = "";
  let bigIdx = 0;
  while (num > 0) {
    let section = num % 10000;
    num = Math.floor(num / 10000);
    let secStr = "";
    let needZero = false;
    for (let i = 0; i < 4; i++) {
      const digit = section % 10;
      section = Math.floor(section / 10);
      if (digit === 0) {
        if (secStr !== "") needZero = true;
      } else {
        if (needZero) {
          secStr = "零" + secStr;
          needZero = false;
        }
        secStr = DIGITS[digit] + (i > 0 ? SMALL_UNITS[i - 1] : "") + secStr;
      }
    }
    if (secStr !== "") {
      result = secStr + BIG_UNITS[bigIdx] + result;
    } else if (result !== "") {
      // 本段为零但上位存在：高位结果已正确，无需补零
    }
    bigIdx++;
  }
  return result;
}

export function rmbUpper(n: number): string {
  if (!Number.isFinite(n)) return "";
  const neg = n < 0;
  n = Math.abs(n);
  const yuan = Math.floor(n);
  const cents = Math.round((n - yuan) * 100);
  const jiao = Math.floor(cents / 10);
  const fen = cents % 10;

  let result = intToUpper(yuan) + "元";
  if (jiao === 0 && fen === 0) {
    result += "整";
  } else {
    if (jiao > 0) {
      result += DIGITS[jiao] + "角";
    } else if (fen > 0 && yuan > 0) {
      result += "零";
    }
    if (fen > 0) result += DIGITS[fen] + "分";
  }
  return (neg ? "负" : "") + result;
}
