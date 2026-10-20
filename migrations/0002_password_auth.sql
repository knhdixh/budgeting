-- Email + password sign-in replaces Google.
ALTER TABLE `users` RENAME COLUMN `google_sub` TO `subject`;
--> statement-breakpoint
DROP INDEX IF EXISTS `users_google_sub_unique`;
--> statement-breakpoint
CREATE UNIQUE INDEX `users_subject_unique` ON `users` (`subject`);
--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ip` text NOT NULL,
	`at` integer NOT NULL,
	`ok` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `login_attempts_ip_at` ON `login_attempts` (`ip`,`at`);
--> statement-breakpoint
CREATE INDEX `login_attempts_at` ON `login_attempts` (`at`);
--> statement-breakpoint
-- Sessions from the old sign-in method end.
DELETE FROM `sessions`;
