-- 工作台快捷入口：每个用户可自定义要显示哪些入口（存入口 id 数组）。
-- 为 NULL 表示该用户没自定义过，前端按角色给一套默认值。
ALTER TABLE `users` ADD COLUMN `shortcuts` JSON NULL;
