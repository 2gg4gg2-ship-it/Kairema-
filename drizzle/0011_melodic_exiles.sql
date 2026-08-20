ALTER TABLE `memory_facts` ADD `source` enum('manual','auto') DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `memory_facts` ADD `version` int DEFAULT 1 NOT NULL;