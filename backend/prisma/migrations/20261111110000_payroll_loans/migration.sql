-- AlterTable
ALTER TABLE `expenses` ADD COLUMN `payrollRunId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `payroll_runs` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `period` VARCHAR(7) NOT NULL,
    `status` ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'PAID') NOT NULL DEFAULT 'DRAFT',
    `note` VARCHAR(300) NULL,
    `createdById` VARCHAR(191) NULL,
    `submittedAt` DATETIME(3) NULL,
    `decidedById` VARCHAR(191) NULL,
    `decidedAt` DATETIME(3) NULL,
    `decisionNote` VARCHAR(300) NULL,
    `paidById` VARCHAR(191) NULL,
    `paidAt` DATETIME(3) NULL,
    `paymentDate` DATE NULL,
    `accountId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `payroll_runs_schoolId_period_key`(`schoolId`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_lines` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `runId` VARCHAR(191) NOT NULL,
    `staffId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `employeeNo` VARCHAR(191) NOT NULL,
    `designation` VARCHAR(191) NULL,
    `department` VARCHAR(191) NULL,
    `bankName` VARCHAR(100) NULL,
    `bankAccountTitle` VARCHAR(100) NULL,
    `bankAccountNo` VARCHAR(40) NULL,
    `basic` DECIMAL(12, 2) NOT NULL,
    `allowances` JSON NOT NULL,
    `fixedDeductions` JSON NOT NULL,
    `gross` DECIMAL(12, 2) NOT NULL,
    `daysInMonth` INTEGER NOT NULL,
    `absentDays` DECIMAL(4, 1) NOT NULL DEFAULT 0,
    `unpaidLeaveDays` DECIMAL(4, 1) NOT NULL DEFAULT 0,
    `notEmployedDays` DECIMAL(4, 1) NOT NULL DEFAULT 0,
    `deductDays` DECIMAL(4, 1) NOT NULL DEFAULT 0,
    `deductDaysManual` BOOLEAN NOT NULL DEFAULT false,
    `absenceDeduction` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `loanDeduction` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `loanManual` BOOLEAN NOT NULL DEFAULT false,
    `bonus` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `otherDeduction` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `remarks` VARCHAR(300) NULL,
    `totalDeductions` DECIMAL(12, 2) NOT NULL,
    `net` DECIMAL(12, 2) NOT NULL,

    INDEX `payroll_lines_schoolId_idx`(`schoolId`),
    INDEX `payroll_lines_staffId_idx`(`staffId`),
    UNIQUE INDEX `payroll_lines_runId_staffId_key`(`runId`, `staffId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `staff_loans` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `loanNo` VARCHAR(191) NOT NULL,
    `staffId` VARCHAR(191) NOT NULL,
    `kind` ENUM('ADVANCE', 'LOAN') NOT NULL DEFAULT 'ADVANCE',
    `amount` DECIMAL(12, 2) NOT NULL,
    `issuedOn` DATE NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `installment` DECIMAL(12, 2) NOT NULL,
    `startPeriod` VARCHAR(7) NOT NULL,
    `note` VARCHAR(300) NULL,
    `status` ENUM('ACTIVE', 'SETTLED') NOT NULL DEFAULT 'ACTIVE',
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `staff_loans_staffId_idx`(`staffId`),
    INDEX `staff_loans_accountId_idx`(`accountId`),
    UNIQUE INDEX `staff_loans_schoolId_loanNo_key`(`schoolId`, `loanNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `loan_repayments` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `loanId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `paidOn` DATE NOT NULL,
    `payrollLineId` VARCHAR(191) NULL,
    `accountId` VARCHAR(191) NULL,
    `note` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `loan_repayments_loanId_idx`(`loanId`),
    INDEX `loan_repayments_accountId_idx`(`accountId`),
    INDEX `loan_repayments_payrollLineId_idx`(`payrollLineId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `expenses_payrollRunId_key` ON `expenses`(`payrollRunId`);

-- AddForeignKey
ALTER TABLE `payroll_lines` ADD CONSTRAINT `payroll_lines_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `payroll_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_lines` ADD CONSTRAINT `payroll_lines_staffId_fkey` FOREIGN KEY (`staffId`) REFERENCES `staff`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `staff_loans` ADD CONSTRAINT `staff_loans_staffId_fkey` FOREIGN KEY (`staffId`) REFERENCES `staff`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `staff_loans` ADD CONSTRAINT `staff_loans_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `money_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `loan_repayments` ADD CONSTRAINT `loan_repayments_loanId_fkey` FOREIGN KEY (`loanId`) REFERENCES `staff_loans`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `loan_repayments` ADD CONSTRAINT `loan_repayments_payrollLineId_fkey` FOREIGN KEY (`payrollLineId`) REFERENCES `payroll_lines`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `loan_repayments` ADD CONSTRAINT `loan_repayments_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `money_accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

