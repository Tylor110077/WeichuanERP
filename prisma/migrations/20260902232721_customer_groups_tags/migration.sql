-- 客户组织/标签（客户归属组织可移动，标签多对多）
CREATE TABLE `customer_groups` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(50) NOT NULL,
  `status` INTEGER NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `customer_groups_name_key` (`name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `customer_tags` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(30) NOT NULL,
  `status` INTEGER NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `customer_tags_name_key` (`name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `customer_tag_links` (
  `customer_id` INTEGER NOT NULL,
  `tag_id` INTEGER NOT NULL,
  INDEX `customer_tag_links_tag_id_idx` (`tag_id`),
  PRIMARY KEY (`customer_id`, `tag_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `customers` ADD COLUMN `group_id` INTEGER NULL;
CREATE INDEX `customers_group_id_idx` ON `customers`(`group_id`);

ALTER TABLE `customers` ADD CONSTRAINT `customers_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `customer_groups`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `customer_tag_links` ADD CONSTRAINT `customer_tag_links_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `customer_tag_links` ADD CONSTRAINT `customer_tag_links_tag_id_fkey` FOREIGN KEY (`tag_id`) REFERENCES `customer_tags`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
