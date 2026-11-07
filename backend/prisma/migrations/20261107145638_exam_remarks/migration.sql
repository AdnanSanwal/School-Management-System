-- CreateTable
CREATE TABLE `exam_remarks` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `examId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `remarks` TEXT NOT NULL,
    `enteredById` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `exam_remarks_schoolId_idx`(`schoolId`),
    UNIQUE INDEX `exam_remarks_examId_studentId_key`(`examId`, `studentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `exam_remarks` ADD CONSTRAINT `exam_remarks_examId_fkey` FOREIGN KEY (`examId`) REFERENCES `exams`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_remarks` ADD CONSTRAINT `exam_remarks_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
