ALTER TABLE `chat_attachments` ADD `expiresAt` timestamp;--> statement-breakpoint
ALTER TABLE `chat_attachments` ADD `expiresAt` timestamp NULL;--> statement-breakpoint
CREATE INDEX `chat_attachments_expires_idx` ON `chat_attachments` (`expiresAt`);
