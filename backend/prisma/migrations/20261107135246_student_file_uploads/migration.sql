-- AlterTable
ALTER TABLE `student_documents` ADD COLUMN `fileName` VARCHAR(191) NULL,
    ADD COLUMN `mimeType` VARCHAR(100) NULL,
    ADD COLUMN `sizeBytes` INTEGER NULL,
    ADD COLUMN `storageKey` VARCHAR(512) NULL,
    MODIFY `url` VARCHAR(1024) NULL;

-- AlterTable
ALTER TABLE `students` ADD COLUMN `photoKey` VARCHAR(512) NULL;
