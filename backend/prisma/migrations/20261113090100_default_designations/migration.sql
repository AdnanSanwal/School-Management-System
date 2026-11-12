-- The standard staff job titles (client change request 04) for every existing school.
-- Schools can add, rename or remove their own afterwards; INSERT IGNORE keeps any they already have.
INSERT IGNORE INTO `designations` (`id`, `schoolId`, `name`, `createdAt`) SELECT UUID(), `id`, 'Principal', CURRENT_TIMESTAMP(3) FROM `schools`;
INSERT IGNORE INTO `designations` (`id`, `schoolId`, `name`, `createdAt`) SELECT UUID(), `id`, 'Vice Principal', CURRENT_TIMESTAMP(3) FROM `schools`;
INSERT IGNORE INTO `designations` (`id`, `schoolId`, `name`, `createdAt`) SELECT UUID(), `id`, 'Teacher', CURRENT_TIMESTAMP(3) FROM `schools`;
INSERT IGNORE INTO `designations` (`id`, `schoolId`, `name`, `createdAt`) SELECT UUID(), `id`, 'Accountant', CURRENT_TIMESTAMP(3) FROM `schools`;
INSERT IGNORE INTO `designations` (`id`, `schoolId`, `name`, `createdAt`) SELECT UUID(), `id`, 'Receptionist', CURRENT_TIMESTAMP(3) FROM `schools`;
INSERT IGNORE INTO `designations` (`id`, `schoolId`, `name`, `createdAt`) SELECT UUID(), `id`, 'Admin Officer', CURRENT_TIMESTAMP(3) FROM `schools`;
INSERT IGNORE INTO `designations` (`id`, `schoolId`, `name`, `createdAt`) SELECT UUID(), `id`, 'Admission Officer', CURRENT_TIMESTAMP(3) FROM `schools`;
INSERT IGNORE INTO `designations` (`id`, `schoolId`, `name`, `createdAt`) SELECT UUID(), `id`, 'Clerk', CURRENT_TIMESTAMP(3) FROM `schools`;
INSERT IGNORE INTO `designations` (`id`, `schoolId`, `name`, `createdAt`) SELECT UUID(), `id`, 'Librarian', CURRENT_TIMESTAMP(3) FROM `schools`;
INSERT IGNORE INTO `designations` (`id`, `schoolId`, `name`, `createdAt`) SELECT UUID(), `id`, 'Computer Operator', CURRENT_TIMESTAMP(3) FROM `schools`;
INSERT IGNORE INTO `designations` (`id`, `schoolId`, `name`, `createdAt`) SELECT UUID(), `id`, 'Driver', CURRENT_TIMESTAMP(3) FROM `schools`;
INSERT IGNORE INTO `designations` (`id`, `schoolId`, `name`, `createdAt`) SELECT UUID(), `id`, 'Security Guard / Watchman', CURRENT_TIMESTAMP(3) FROM `schools`;
INSERT IGNORE INTO `designations` (`id`, `schoolId`, `name`, `createdAt`) SELECT UUID(), `id`, 'Sweeper', CURRENT_TIMESTAMP(3) FROM `schools`;
INSERT IGNORE INTO `designations` (`id`, `schoolId`, `name`, `createdAt`) SELECT UUID(), `id`, 'Cleaner', CURRENT_TIMESTAMP(3) FROM `schools`;
INSERT IGNORE INTO `designations` (`id`, `schoolId`, `name`, `createdAt`) SELECT UUID(), `id`, 'Peon', CURRENT_TIMESTAMP(3) FROM `schools`;
INSERT IGNORE INTO `designations` (`id`, `schoolId`, `name`, `createdAt`) SELECT UUID(), `id`, 'Lab Assistant', CURRENT_TIMESTAMP(3) FROM `schools`;
INSERT IGNORE INTO `designations` (`id`, `schoolId`, `name`, `createdAt`) SELECT UUID(), `id`, 'Coordinator', CURRENT_TIMESTAMP(3) FROM `schools`;
INSERT IGNORE INTO `designations` (`id`, `schoolId`, `name`, `createdAt`) SELECT UUID(), `id`, 'HR Manager', CURRENT_TIMESTAMP(3) FROM `schools`;
INSERT IGNORE INTO `designations` (`id`, `schoolId`, `name`, `createdAt`) SELECT UUID(), `id`, 'Support Staff', CURRENT_TIMESTAMP(3) FROM `schools`;
INSERT IGNORE INTO `designations` (`id`, `schoolId`, `name`, `createdAt`) SELECT UUID(), `id`, 'Other', CURRENT_TIMESTAMP(3) FROM `schools`;
