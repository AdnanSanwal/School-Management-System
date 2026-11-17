CREATE TABLE `ai_settings` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `ownProvider` VARCHAR(20) NULL,
    `ownModel` VARCHAR(80) NULL,
    `ownKey` TEXT NULL,
    `ownAllowed` BOOLEAN NOT NULL DEFAULT true,
    `grantEnabled` BOOLEAN NOT NULL DEFAULT false,
    `grantProvider` VARCHAR(20) NULL,
    `grantModel` VARCHAR(80) NULL,
    `grantKey` TEXT NULL,
    `dailyLimit` INTEGER NULL,
    `monthlyLimit` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ai_settings_schoolId_key`(`schoolId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `platform_ai_keys` (
    `provider` VARCHAR(20) NOT NULL,
    `apiKey` TEXT NOT NULL,
    `model` VARCHAR(80) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`provider`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_usage` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `source` VARCHAR(10) NOT NULL,
    `provider` VARCHAR(20) NOT NULL,
    `model` VARCHAR(80) NOT NULL,
    `feature` VARCHAR(30) NOT NULL,
    `questions` INTEGER NOT NULL DEFAULT 0,
    `inputTokens` INTEGER NOT NULL DEFAULT 0,
    `outputTokens` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_usage_schoolId_createdAt_idx`(`schoolId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
