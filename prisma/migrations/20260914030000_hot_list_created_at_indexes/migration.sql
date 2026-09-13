-- 库存流水 / 审计日志 / 登录日志的默认视图都是"按时间倒序、不加筛选"，
-- 而这三张表都没有单独的 created_at 索引 → 数据长大后 MySQL 只能全表扫描 + filesort。
-- 补三个索引，让默认视图与"最近 N 条"这类查询走索引。
CREATE INDEX `stock_movements_created_at_idx` ON `stock_movements`(`created_at`);
CREATE INDEX `audit_logs_created_at_idx` ON `audit_logs`(`created_at`);
CREATE INDEX `login_logs_created_at_idx` ON `login_logs`(`created_at`);
