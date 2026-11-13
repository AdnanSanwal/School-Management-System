-- AlterTable
ALTER TABLE `schools` ADD COLUMN `brandId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `brands` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `logoUrl` VARCHAR(1024) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'Asia/Karachi',
    `currency` VARCHAR(191) NOT NULL DEFAULT 'PKR',
    `licencePlan` VARCHAR(60) NULL,
    `licencePaidUntil` DATE NULL,
    `licenceGraceDays` INTEGER NOT NULL DEFAULT 7,
    `licenceNotifyDays` INTEGER NOT NULL DEFAULT 10,
    `licenceOverride` BOOLEAN NOT NULL DEFAULT false,
    `licenceMessage` VARCHAR(300) NULL,
    `maxBranches` INTEGER NULL,
    `maxStudents` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `brands_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `brand_owners` (
    `brandId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    INDEX `brand_owners_userId_idx`(`userId`),
    PRIMARY KEY (`brandId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `branch_access` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `role` ENUM('SUPER_ADMIN', 'OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT') NOT NULL,
    `customRoleId` VARCHAR(191) NULL,
    `staffId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `branch_access_userId_idx`(`userId`),
    UNIQUE INDEX `branch_access_schoolId_userId_key`(`schoolId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `brand_licence_payments` (
    `id` VARCHAR(191) NOT NULL,
    `brandId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'PKR',
    `paidOn` DATE NOT NULL,
    `coversUntil` DATE NOT NULL,
    `paidUntilBefore` DATE NULL,
    `method` VARCHAR(191) NULL,
    `reference` VARCHAR(191) NULL,
    `note` VARCHAR(300) NULL,
    `recordedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `brand_licence_payments_brandId_createdAt_idx`(`brandId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `brand_owners` ADD CONSTRAINT `brand_owners_brandId_fkey` FOREIGN KEY (`brandId`) REFERENCES `brands`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `brand_owners` ADD CONSTRAINT `brand_owners_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `branch_access` ADD CONSTRAINT `branch_access_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `branch_access` ADD CONSTRAINT `branch_access_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `brand_licence_payments` ADD CONSTRAINT `brand_licence_payments_brandId_fkey` FOREIGN KEY (`brandId`) REFERENCES `brands`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schools` ADD CONSTRAINT `schools_brandId_fkey` FOREIGN KEY (`brandId`) REFERENCES `brands`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
-- Preserve legacy demo installations as one brand per existing school.
INSERT INTO brands (id, name, code, logoUrl, isActive, timezone, currency, licencePlan, licencePaidUntil, licenceGraceDays, licenceNotifyDays, licenceOverride, licenceMessage, maxStudents, createdAt, updatedAt)
SELECT id, name, code, logoUrl, isActive, timezone, currency, licencePlan, licencePaidUntil, licenceGraceDays, licenceNotifyDays, licenceOverride, licenceMessage, maxStudents, createdAt, updatedAt FROM schools;
UPDATE schools SET brandId = id;
INSERT INTO brand_owners (brandId, userId) SELECT schoolId, id FROM users WHERE role = 'OWNER' AND schoolId IS NOT NULL;
INSERT INTO brand_licence_payments (id, brandId, amount, currency, paidOn, coversUntil, paidUntilBefore, method, reference, note, recordedById, createdAt)
SELECT id, schoolId, amount, currency, paidOn, coversUntil, paidUntilBefore, method, reference, note, recordedById, createdAt FROM licence_payments;
