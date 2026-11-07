-- AlterTable
ALTER TABLE `fee_invoices` ADD COLUMN `fineAppliedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `schools` ADD COLUMN `lateFeeAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `lateFeeGraceDays` INTEGER NOT NULL DEFAULT 7,
    ADD COLUMN `lowAttendanceThreshold` INTEGER NOT NULL DEFAULT 75;

-- CreateTable
CREATE TABLE `payment_accounts` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `method` ENUM('CASH', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'JAZZCASH', 'EASYPAISA', 'ONLINE') NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `accountNo` VARCHAR(191) NOT NULL,
    `bankName` VARCHAR(191) NULL,
    `iban` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payment_accounts_schoolId_idx`(`schoolId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_claims` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `invoiceIds` JSON NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `method` ENUM('CASH', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'JAZZCASH', 'EASYPAISA', 'ONLINE') NOT NULL,
    `reference` VARCHAR(191) NOT NULL,
    `proofKey` VARCHAR(512) NULL,
    `note` VARCHAR(191) NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `submittedById` VARCHAR(191) NOT NULL,
    `decidedById` VARCHAR(191) NULL,
    `decidedAt` DATETIME(3) NULL,
    `decisionNote` VARCHAR(191) NULL,
    `paymentId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `payment_claims_paymentId_key`(`paymentId`),
    INDEX `payment_claims_schoolId_status_idx`(`schoolId`, `status`),
    UNIQUE INDEX `payment_claims_schoolId_method_reference_key`(`schoolId`, `method`, `reference`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_intents` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `invoiceIds` JSON NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `provider` VARCHAR(20) NOT NULL,
    `status` ENUM('CREATED', 'SUCCEEDED', 'FAILED', 'EXPIRED') NOT NULL DEFAULT 'CREATED',
    `providerRef` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `paymentId` VARCHAR(191) NULL,
    `error` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payment_intents_paymentId_key`(`paymentId`),
    INDEX `payment_intents_schoolId_status_idx`(`schoolId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `payment_claims` ADD CONSTRAINT `payment_claims_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_intents` ADD CONSTRAINT `payment_intents_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
