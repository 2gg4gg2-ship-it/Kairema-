ALTER TABLE `messages` ADD `clientMessageId` varchar(36);--> statement-breakpoint
ALTER TABLE `messages` ADD CONSTRAINT `messages_client_message_id_unique` UNIQUE(`clientMessageId`);
