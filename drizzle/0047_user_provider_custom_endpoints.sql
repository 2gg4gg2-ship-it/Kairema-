ALTER TABLE `user_provider_configs` ADD COLUMN `displayName` varchar(64) NULL;--> statement-breakpoint
ALTER TABLE `user_provider_configs` ADD COLUMN `baseUrl` varchar(300) NULL;--> statement-breakpoint
ALTER TABLE `user_provider_configs` ADD COLUMN `modelsEndpoint` varchar(300) NULL;
