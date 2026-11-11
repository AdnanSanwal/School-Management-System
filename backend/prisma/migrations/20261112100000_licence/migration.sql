-- AlterTable
ALTER TABLE `schools` ADD COLUMN `licenceGraceDays` INTEGER NOT NULL DEFAULT 7,
    ADD COLUMN `licenceMessage` VARCHAR(300) NULL,
    ADD COLUMN `licenceNotifyDays` INTEGER NOT NULL DEFAULT 10,
    ADD COLUMN `licenceOverride` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `licencePaidUntil` DATE NULL,
    ADD COLUMN `licencePlan` VARCHAR(60) NULL,
    ADD COLUMN `maxStudents` INTEGER NULL;

-- CreateTable
CREATE TABLE `licence_payments` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `currency` VARCHAR(8) NOT NULL DEFAULT 'PKR',
    `paidOn` DATE NOT NULL,
    `coversUntil` DATE NOT NULL,
    `method` VARCHAR(40) NULL,
    `reference` VARCHAR(100) NULL,
    `note` VARCHAR(300) NULL,
    `recordedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `licence_payments_schoolId_paidOn_idx`(`schoolId`, `paidOn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- AlterTable
ALTER TABLE `licence_payments` ADD COLUMN `paidUntilBefore` DATE NULL;
