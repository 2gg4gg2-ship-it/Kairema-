ALTER TABLE `search_quality_metrics` ADD `taskKind` varchar(16);--> statement-breakpoint
ALTER TABLE `search_quality_metrics` ADD `valueConfirmed` int;--> statement-breakpoint
ALTER TABLE `search_quality_metrics` ADD `targetedPass` int;