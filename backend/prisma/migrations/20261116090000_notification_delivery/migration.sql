-- Durable push delivery queue on the notifications table, and the SMS fallback switch.
-- Existing rows default to NONE, so nothing old is re-sent.
ALTER TABLE `notifications`
  ADD COLUMN `deliveryState` ENUM('NONE', 'PENDING', 'DELIVERED', 'UNREACHED', 'FAILED', 'EXPIRED') NOT NULL DEFAULT 'NONE',
  ADD COLUMN `deliveryAttempts` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `deliverAfter` DATETIME(3) NULL,
  ADD COLUMN `deliveryLock` VARCHAR(40) NULL,
  ADD COLUMN `deliveryLockedUntil` DATETIME(3) NULL,
  ADD COLUMN `deliveredAt` DATETIME(3) NULL,
  ADD COLUMN `deliveryError` VARCHAR(300) NULL;

CREATE INDEX `notifications_userId_readAt_idx` ON `notifications`(`userId`, `readAt`);
CREATE INDEX `notifications_deliveryState_deliverAfter_idx` ON `notifications`(`deliveryState`, `deliverAfter`);

ALTER TABLE `schools` ADD COLUMN `messagingFallback` BOOLEAN NOT NULL DEFAULT false;
