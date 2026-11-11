-- AlterTable
ALTER TABLE `payments` ADD COLUMN `accountId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `schools` ADD COLUMN `expenseApprovalLimit` DECIMAL(12, 2) NULL;

-- CreateTable
CREATE TABLE `money_accounts` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `type` ENUM('CASH', 'BANK', 'WALLET') NOT NULL DEFAULT 'CASH',
    `accountNo` VARCHAR(40) NULL,
    `methods` JSON NOT NULL,
    `openingBalance` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `openingDate` DATE NOT NULL,
    `notes` VARCHAR(300) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `money_accounts_schoolId_name_key`(`schoolId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `money_transactions` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `type` ENUM('DEPOSIT', 'WITHDRAWAL', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'TRANSFER_IN', 'TRANSFER_OUT') NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `txDate` DATE NOT NULL,
    `description` VARCHAR(300) NULL,
    `reference` VARCHAR(100) NULL,
    `transferId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `money_transactions_schoolId_txDate_idx`(`schoolId`, `txDate`),
    INDEX `money_transactions_accountId_txDate_idx`(`accountId`, `txDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `finance_categories` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `kind` ENUM('EXPENSE', 'INCOME') NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `finance_categories_schoolId_kind_name_key`(`schoolId`, `kind`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `expenses` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `expenseNo` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `expenseDate` DATE NOT NULL,
    `paidTo` VARCHAR(120) NULL,
    `description` VARCHAR(500) NOT NULL,
    `reference` VARCHAR(100) NULL,
    `receiptKey` VARCHAR(512) NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'APPROVED',
    `requestedById` VARCHAR(191) NULL,
    `decidedById` VARCHAR(191) NULL,
    `decidedAt` DATETIME(3) NULL,
    `decisionNote` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `expenses_schoolId_expenseDate_idx`(`schoolId`, `expenseDate`),
    INDEX `expenses_accountId_idx`(`accountId`),
    UNIQUE INDEX `expenses_schoolId_expenseNo_key`(`schoolId`, `expenseNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `other_incomes` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `incomeNo` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `incomeDate` DATE NOT NULL,
    `receivedFrom` VARCHAR(120) NULL,
    `description` VARCHAR(500) NOT NULL,
    `reference` VARCHAR(100) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `other_incomes_schoolId_incomeDate_idx`(`schoolId`, `incomeDate`),
    INDEX `other_incomes_accountId_idx`(`accountId`),
    UNIQUE INDEX `other_incomes_schoolId_incomeNo_key`(`schoolId`, `incomeNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `payments_accountId_idx` ON `payments`(`accountId`);

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `money_accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `money_transactions` ADD CONSTRAINT `money_transactions_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `money_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `finance_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `money_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `other_incomes` ADD CONSTRAINT `other_incomes_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `finance_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `other_incomes` ADD CONSTRAINT `other_incomes_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `money_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

