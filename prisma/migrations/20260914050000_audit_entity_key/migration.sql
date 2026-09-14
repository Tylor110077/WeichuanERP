-- 审计表的非数字标识列：让 "backup-config" 这类字符串标识有地方落，
-- 不再因为走 entity_id 的 BigInt() 抛错而被静默丢弃（备份配置变更此前完全无审计）。
-- AlterTable
ALTER TABLE `audit_logs` ADD COLUMN `entity_key` VARCHAR(64) NULL;
