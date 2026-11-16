-- Per-person mutes, school quiet hours, office broadcasts with a delivery report.
ALTER TABLE `users` ADD COLUMN `mutedNotifications` JSON NULL;

ALTER TABLE `schools`
  ADD COLUMN `quietHoursStart` VARCHAR(5) NULL,
  ADD COLUMN `quietHoursEnd` VARCHAR(5) NULL;

ALTER TABLE `notifications` ADD COLUMN `broadcastId` VARCHAR(191) NULL;
CREATE INDEX `notifications_broadcastId_deliveryState_idx` ON `notifications`(`broadcastId`, `deliveryState`);
CREATE INDEX `notifications_createdAt_idx` ON `notifications`(`createdAt`);

CREATE TABLE `broadcasts` (
  `id` VARCHAR(191) NOT NULL,
  `schoolId` VARCHAR(191) NOT NULL,
  `title` VARCHAR(150) NOT NULL,
  `body` TEXT NOT NULL,
  `audience` JSON NOT NULL,
  `scheduledAt` DATETIME(3) NULL,
  `status` ENUM('SCHEDULED', 'SENDING', 'SENT', 'CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
  `sendingSince` DATETIME(3) NULL,
  `sentAt` DATETIME(3) NULL,
  `recipients` INTEGER NOT NULL DEFAULT 0,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `broadcasts_schoolId_createdAt_idx`(`schoolId`, `createdAt`),
  INDEX `broadcasts_status_scheduledAt_idx`(`status`, `scheduledAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
