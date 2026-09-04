CREATE TABLE `cu_prices` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `price_date` DATETIME(3) NOT NULL,
  `price` DECIMAL(10,2) NOT NULL,
  `intraday` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `cu_prices_price_date_key` (`price_date`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
