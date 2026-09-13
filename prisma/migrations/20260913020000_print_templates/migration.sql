-- 打印模板：把打印页的那套版式设置（打印方式/列显隐/显示选项/收款账户/抬头页脚）存进库，
-- 可以保存多套、选一套套用，并指定默认模板（打开打印页自动套用）。
CREATE TABLE `print_templates` (
  `id`          INT NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(50) NOT NULL,
  `kind`        VARCHAR(20) NOT NULL DEFAULT 'sale',
  `config`      JSON NOT NULL,
  `is_default`  BOOLEAN NOT NULL DEFAULT false,
  `operator_id` INT NOT NULL,
  `created_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `print_templates_kind_idx` (`kind`),
  CONSTRAINT `print_templates_operator_id_fkey`
    FOREIGN KEY (`operator_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
