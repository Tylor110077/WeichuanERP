-- 客户资料去掉「联系人」字段：全流程（建档、详情、列表、搜索、开单页快捷新建、打印稿）
-- 都已不再使用它。经销商（suppliers）的联系人保留不动。
ALTER TABLE `customers` DROP COLUMN `contact`;
