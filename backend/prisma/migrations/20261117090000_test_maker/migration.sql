-- Test maker: chapters and topics, the question bank, saved papers.
CREATE TABLE `chapters` (
  `id` VARCHAR(191) NOT NULL,
  `schoolId` VARCHAR(191) NOT NULL,
  `classId` VARCHAR(191) NOT NULL,
  `subjectId` VARCHAR(191) NOT NULL,
  `number` INTEGER NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `nameUr` VARCHAR(150) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `chapters_schoolId_idx`(`schoolId`),
  UNIQUE INDEX `chapters_classId_subjectId_number_key`(`classId`, `subjectId`, `number`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `topics` (
  `id` VARCHAR(191) NOT NULL,
  `schoolId` VARCHAR(191) NOT NULL,
  `chapterId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `nameUr` VARCHAR(150) NULL,

  INDEX `topics_schoolId_idx`(`schoolId`),
  INDEX `topics_chapterId_idx`(`chapterId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `questions` (
  `id` VARCHAR(191) NOT NULL,
  `schoolId` VARCHAR(191) NOT NULL,
  `classId` VARCHAR(191) NOT NULL,
  `subjectId` VARCHAR(191) NOT NULL,
  `chapterId` VARCHAR(191) NOT NULL,
  `topicId` VARCHAR(191) NULL,
  `type` ENUM('MCQ', 'TRUE_FALSE', 'BLANK', 'SHORT', 'LONG', 'MATCH') NOT NULL,
  `textEn` TEXT NULL,
  `textUr` TEXT NULL,
  `options` JSON NULL,
  `answer` JSON NULL,
  `marks` DECIMAL(5, 2) NOT NULL DEFAULT 1,
  `source` VARCHAR(20) NULL,
  `imageKey` VARCHAR(255) NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `questions_schoolId_idx`(`schoolId`),
  INDEX `questions_classId_subjectId_type_idx`(`classId`, `subjectId`, `type`),
  INDEX `questions_chapterId_type_idx`(`chapterId`, `type`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `papers` (
  `id` VARCHAR(191) NOT NULL,
  `schoolId` VARCHAR(191) NOT NULL,
  `classId` VARCHAR(191) NOT NULL,
  `subjectId` VARCHAR(191) NOT NULL,
  `title` VARCHAR(150) NOT NULL,
  `medium` VARCHAR(4) NOT NULL,
  `durationMinutes` INTEGER NULL,
  `totalMarks` DECIMAL(6, 2) NOT NULL,
  `instructions` TEXT NULL,
  `sections` JSON NOT NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `papers_schoolId_createdAt_idx`(`schoolId`, `createdAt`),
  INDEX `papers_classId_subjectId_idx`(`classId`, `subjectId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `topics` ADD CONSTRAINT `topics_chapterId_fkey` FOREIGN KEY (`chapterId`) REFERENCES `chapters`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `questions` ADD CONSTRAINT `questions_chapterId_fkey` FOREIGN KEY (`chapterId`) REFERENCES `chapters`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `questions` ADD CONSTRAINT `questions_topicId_fkey` FOREIGN KEY (`topicId`) REFERENCES `topics`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
