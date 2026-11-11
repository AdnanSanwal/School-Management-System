-- CreateTable
CREATE TABLE `role_permissions` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `role` ENUM('SUPER_ADMIN', 'OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT') NOT NULL,
    `permission` VARCHAR(60) NOT NULL,
    `granted` BOOLEAN NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `role_permissions_schoolId_role_permission_key`(`schoolId`, `role`, `permission`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

