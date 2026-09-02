import { hash, verify } from "@node-rs/argon2";

/**
 * 密码哈希与校验（argon2id，文档 3.9 / 8.1：argon2/bcrypt 哈希、每用户独立盐）。
 * @node-rs/argon2 默认即 argon2id + 随机盐，无需手工管理盐。
 */

// 用于"用户不存在"时的等时校验，避免通过响应时间枚举用户是否存在
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$yE1z1r5K0cMn7nbv0Y2R3w$1yF8LqQVhHJoRGQZ1G0LEiD6NQZU7Y0HnFQb4d6c8Xk";

export async function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(
  password: string,
  passwordHash: string
): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** 用户不存在时调用，耗时与真实校验一致（防时序枚举）。 */
export async function consumeDummyVerify(): Promise<void> {
  try {
    await verify(DUMMY_HASH, "dummy-password");
  } catch {
    // 恒失败，仅为耗时
  }
}

/** 密码强度校验：≥8 位且至少包含字母与数字（初始/重置密码共用）。 */
export function validatePasswordStrength(pw: string): string | null {
  if (pw.length < 8) return "密码至少 8 位";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "密码需同时包含字母和数字";
  return null;
}
