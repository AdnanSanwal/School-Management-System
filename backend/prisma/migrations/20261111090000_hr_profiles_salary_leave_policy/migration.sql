-- AlterTable
ALTER TABLE `leave_requests` MODIFY `type` ENUM('CASUAL', 'SICK', 'ANNUAL', 'UNPAID', 'OTHER') NOT NULL DEFAULT 'CASUAL';

-- AlterTable
ALTER TABLE `staff` ADD COLUMN `address` TEXT NULL,
    ADD COLUMN `bankAccountNo` VARCHAR(40) NULL,
    ADD COLUMN `bankAccountTitle` VARCHAR(100) NULL,
    ADD COLUMN `bankName` VARCHAR(100) NULL,
    ADD COLUMN `cnic` VARCHAR(20) NULL,
    ADD COLUMN `contractType` ENUM('PERMANENT', 'CONTRACT', 'VISITING') NOT NULL DEFAULT 'PERMANENT',
    ADD COLUMN `dateOfBirth` DATE NULL,
    ADD COLUMN `email` VARCHAR(191) NULL,
    ADD COLUMN `emergencyContactName` VARCHAR(100) NULL,
    ADD COLUMN `emergencyContactPhone` VARCHAR(32) NULL,
    ADD COLUMN `gender` ENUM('MALE', 'FEMALE', 'OTHER') NULL,
    ADD COLUMN `leftOn` DATE NULL;

-- CreateTable
CREATE TABLE `staff_documents` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `staffId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `storageKey` VARCHAR(512) NOT NULL,
    `fileName` VARCHAR(191) NULL,
    `mimeType` VARCHAR(100) NULL,
    `sizeBytes` INTEGER NULL,
    `uploadedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `staff_documents_schoolId_idx`(`schoolId`),
    INDEX `staff_documents_staffId_idx`(`staffId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `departments` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `departments_schoolId_name_key`(`schoolId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `designations` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `designations_schoolId_name_key`(`schoolId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `salary_structures` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `staffId` VARCHAR(191) NOT NULL,
    `effectiveFrom` DATE NOT NULL,
    `basic` DECIMAL(12, 2) NOT NULL,
    `note` VARCHAR(300) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `salary_structures_schoolId_idx`(`schoolId`),
    UNIQUE INDEX `salary_structures_staffId_effectiveFrom_key`(`staffId`, `effectiveFrom`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `salary_components` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `structureId` VARCHAR(191) NOT NULL,
    `kind` ENUM('ALLOWANCE', 'DEDUCTION') NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,

    INDEX `salary_components_schoolId_idx`(`schoolId`),
    INDEX `salary_components_structureId_idx`(`structureId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leave_policies` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `type` ENUM('CASUAL', 'SICK', 'ANNUAL', 'UNPAID', 'OTHER') NOT NULL,
    `daysPerYear` INTEGER NOT NULL DEFAULT 0,
    `isPaid` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `leave_policies_schoolId_type_key`(`schoolId`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `staff_documents` ADD CONSTRAINT `staff_documents_staffId_fkey` FOREIGN KEY (`staffId`) REFERENCES `staff`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `salary_structures` ADD CONSTRAINT `salary_structures_staffId_fkey` FOREIGN KEY (`staffId`) REFERENCES `staff`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `salary_components` ADD CONSTRAINT `salary_components_structureId_fkey` FOREIGN KEY (`structureId`) REFERENCES `salary_structures`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

