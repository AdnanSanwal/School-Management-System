-- CreateTable
CREATE TABLE `staff_attendance_policies` (
    `schoolId` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `weekdays` JSON NOT NULL,
    `startTime` VARCHAR(5) NOT NULL,
    `endTime` VARCHAR(5) NOT NULL,
    `graceMinutes` INTEGER NOT NULL DEFAULT 15,
    `earlyMinutes` INTEGER NOT NULL DEFAULT 60,
    `minimumMinutes` INTEGER NOT NULL DEFAULT 240,
    `gpsRequired` BOOLEAN NOT NULL DEFAULT false,
    `latitude` DOUBLE NULL,
    `longitude` DOUBLE NULL,
    `radiusMeters` INTEGER NOT NULL DEFAULT 150,
    `maxAccuracyMeters` INTEGER NOT NULL DEFAULT 100,
    `correctionDays` INTEGER NOT NULL DEFAULT 31,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`schoolId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `staff_attendance_corrections` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `staffId` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `requestedById` VARCHAR(191) NOT NULL,
    `requestedStatus` ENUM('PRESENT', 'ABSENT', 'LATE', 'LEAVE', 'HALF_DAY') NOT NULL,
    `requestedCheckIn` DATETIME(3) NULL,
    `requestedCheckOut` DATETIME(3) NULL,
    `reason` VARCHAR(500) NOT NULL,
    `baseline` JSON NOT NULL,
    `pendingKey` VARCHAR(120) NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `decidedById` VARCHAR(191) NULL,
    `decisionNote` VARCHAR(500) NULL,
    `decidedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `staff_attendance_corrections_pendingKey_key`(`pendingKey`),
    INDEX `staff_attendance_corrections_schoolId_status_createdAt_idx`(`schoolId`, `status`, `createdAt`),
    INDEX `staff_attendance_corrections_schoolId_staffId_date_idx`(`schoolId`, `staffId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `staff_attendance_corrections` ADD CONSTRAINT `staff_attendance_corrections_staffId_fkey` FOREIGN KEY (`staffId`) REFERENCES `staff`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

