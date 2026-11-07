-- Office logins (principal, admin, accountant) get a staff record so they can apply
-- for leave and appear in staff attendance and reports. Existing installs only.
INSERT INTO `staff` (`id`, `schoolId`, `userId`, `employeeNo`, `name`, `phone`, `designation`, `department`, `isTeacher`, `status`, `createdAt`, `updatedAt`)
SELECT UUID(), u.`schoolId`, u.`id`, CONCAT('OFF-', UPPER(LEFT(REPLACE(u.`id`, '-', ''), 8))), u.`name`, u.`phone`,
       CASE u.`role` WHEN 'PRINCIPAL' THEN 'Principal' WHEN 'ADMIN' THEN 'Office administrator' ELSE 'Accountant' END,
       'Administration', false, 'ACTIVE', NOW(3), NOW(3)
FROM `users` u
LEFT JOIN `staff` s ON s.`userId` = u.`id`
WHERE u.`role` IN ('PRINCIPAL', 'ADMIN', 'ACCOUNTANT') AND u.`schoolId` IS NOT NULL AND s.`id` IS NULL;
