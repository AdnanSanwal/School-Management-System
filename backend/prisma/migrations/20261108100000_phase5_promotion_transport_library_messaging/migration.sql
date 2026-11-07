-- AlterTable
ALTER TABLE `schools` ADD COLUMN `libraryFinePerDay` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `messagingChannel` ENUM('SMS', 'WHATSAPP') NOT NULL DEFAULT 'SMS',
    ADD COLUMN `messagingEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `messagingTypes` JSON NULL;

-- CreateTable
CREATE TABLE `promotion_records` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `fromAcademicYearId` VARCHAR(191) NOT NULL,
    `toAcademicYearId` VARCHAR(191) NOT NULL,
    `fromSectionId` VARCHAR(191) NULL,
    `toSectionId` VARCHAR(191) NULL,
    `outcome` ENUM('PROMOTED', 'RETAINED', 'GRADUATED', 'LEFT') NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `promotion_records_schoolId_toAcademicYearId_idx`(`schoolId`, `toAcademicYearId`),
    UNIQUE INDEX `promotion_records_studentId_toAcademicYearId_key`(`studentId`, `toAcademicYearId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transport_routes` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `vehicleNo` VARCHAR(191) NULL,
    `driverName` VARCHAR(191) NULL,
    `driverPhone` VARCHAR(32) NULL,
    `capacity` INTEGER NULL,
    `monthlyFee` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `transport_routes_schoolId_idx`(`schoolId`),
    UNIQUE INDEX `transport_routes_schoolId_name_key`(`schoolId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transport_stops` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `routeId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `pickupTime` VARCHAR(5) NULL,
    `dropTime` VARCHAR(5) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    INDEX `transport_stops_schoolId_idx`(`schoolId`),
    INDEX `transport_stops_routeId_idx`(`routeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_transport` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `routeId` VARCHAR(191) NOT NULL,
    `stopId` VARCHAR(191) NULL,
    `since` DATE NOT NULL,

    UNIQUE INDEX `student_transport_studentId_key`(`studentId`),
    INDEX `student_transport_schoolId_idx`(`schoolId`),
    INDEX `student_transport_routeId_idx`(`routeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `books` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `author` VARCHAR(191) NULL,
    `isbn` VARCHAR(20) NULL,
    `category` VARCHAR(191) NULL,
    `shelf` VARCHAR(191) NULL,
    `copies` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `books_schoolId_idx`(`schoolId`),
    INDEX `books_schoolId_title_idx`(`schoolId`, `title`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `book_issues` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `bookId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `issuedAt` DATE NOT NULL,
    `dueDate` DATE NOT NULL,
    `returnedAt` DATE NULL,
    `fine` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `finePaid` BOOLEAN NOT NULL DEFAULT false,
    `issuedById` VARCHAR(191) NOT NULL,

    INDEX `book_issues_schoolId_returnedAt_idx`(`schoolId`, `returnedAt`),
    INDEX `book_issues_bookId_idx`(`bookId`),
    INDEX `book_issues_studentId_idx`(`studentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `homework_status` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `diaryEntryId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `markedById` VARCHAR(191) NOT NULL,
    `markedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `homework_status_schoolId_idx`(`schoolId`),
    UNIQUE INDEX `homework_status_diaryEntryId_studentId_key`(`diaryEntryId`, `studentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `outbound_messages` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `channel` ENUM('SMS', 'WHATSAPP') NOT NULL,
    `to` VARCHAR(32) NOT NULL,
    `body` TEXT NOT NULL,
    `provider` VARCHAR(20) NOT NULL,
    `status` ENUM('QUEUED', 'SENT', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `providerRef` VARCHAR(191) NULL,
    `error` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `outbound_messages_schoolId_createdAt_idx`(`schoolId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `promotion_records` ADD CONSTRAINT `promotion_records_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_stops` ADD CONSTRAINT `transport_stops_routeId_fkey` FOREIGN KEY (`routeId`) REFERENCES `transport_routes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_transport` ADD CONSTRAINT `student_transport_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_transport` ADD CONSTRAINT `student_transport_routeId_fkey` FOREIGN KEY (`routeId`) REFERENCES `transport_routes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_transport` ADD CONSTRAINT `student_transport_stopId_fkey` FOREIGN KEY (`stopId`) REFERENCES `transport_stops`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `book_issues` ADD CONSTRAINT `book_issues_bookId_fkey` FOREIGN KEY (`bookId`) REFERENCES `books`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `book_issues` ADD CONSTRAINT `book_issues_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `homework_status` ADD CONSTRAINT `homework_status_diaryEntryId_fkey` FOREIGN KEY (`diaryEntryId`) REFERENCES `diary_entries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `homework_status` ADD CONSTRAINT `homework_status_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

