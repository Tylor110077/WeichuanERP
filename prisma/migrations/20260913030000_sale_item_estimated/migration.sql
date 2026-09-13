-- 估价待补：售卖单的行可以标为"估价"——开单时只填售价，进价与货源后补。
-- 这种行不消耗库存、不生成自动补货进货单、成本记 0；补单时再把真实成本写回该行，
-- 因此不会影响其它单据的移动加权成本（它压根没参与过库存）。
ALTER TABLE `sale_order_items`
  ADD COLUMN `estimated` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `estimated_resolved_at` DATETIME(3) NULL,
  ADD COLUMN `estimated_purchase_order_id` INT NULL;
