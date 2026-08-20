ALTER TABLE `user_settings` ADD `exportSortBy` enum('createdAt','byteSize') DEFAULT 'createdAt' NOT NULL;
