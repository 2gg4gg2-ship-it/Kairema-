ALTER TABLE `users` ADD `isGuest` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `expiresAt` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `lastActivityAt` timestamp DEFAULT (now()) NOT NULL;--> statement-breakpoint
CREATE INDEX `users_guest_expires_idx` ON `users` (`isGuest`,`expiresAt`);