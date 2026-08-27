ALTER TABLE `capacity_controller_settings` MODIFY COLUMN `queueEligibleRolesJson` varchar(64) NOT NULL DEFAULT '["fast"]';--> statement-breakpoint
ALTER TABLE `capacity_reservations` MODIFY COLUMN `inflightScopeKeysJson` text NOT NULL;
