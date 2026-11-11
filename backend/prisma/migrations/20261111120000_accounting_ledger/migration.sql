-- AlterTable
ALTER TABLE `schools` ADD COLUMN `booksClosedThrough` VARCHAR(7) NULL;

-- CreateTable
CREATE TABLE `ledger_accounts` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(10) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `type` ENUM('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE') NOT NULL,
    `systemKey` VARCHAR(30) NULL,
    `moneyAccountId` VARCHAR(191) NULL,
    `categoryId` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ledger_accounts_moneyAccountId_key`(`moneyAccountId`),
    UNIQUE INDEX `ledger_accounts_categoryId_key`(`categoryId`),
    UNIQUE INDEX `ledger_accounts_schoolId_code_key`(`schoolId`, `code`),
    UNIQUE INDEX `ledger_accounts_schoolId_systemKey_key`(`schoolId`, `systemKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `journal_entries` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `entryNo` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `description` VARCHAR(300) NOT NULL,
    `reference` VARCHAR(100) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `journal_entries_schoolId_date_idx`(`schoolId`, `date`),
    UNIQUE INDEX `journal_entries_schoolId_entryNo_key`(`schoolId`, `entryNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `journal_lines` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `entryId` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `debit` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `credit` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `date` DATE NOT NULL,
    `moneyAccountId` VARCHAR(191) NULL,

    INDEX `journal_lines_schoolId_date_idx`(`schoolId`, `date`),
    INDEX `journal_lines_accountId_idx`(`accountId`),
    INDEX `journal_lines_moneyAccountId_idx`(`moneyAccountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_entryId_fkey` FOREIGN KEY (`entryId`) REFERENCES `journal_entries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `ledger_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

