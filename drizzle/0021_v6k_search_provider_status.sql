ALTER TABLE `search_outage_logs` MODIFY COLUMN `layer` varchar(32) NOT NULL;--> statement-breakpoint
ALTER TABLE `web_search_status`
  ADD COLUMN `youHttp` int NULL,
  ADD COLUMN `serperHttp` int NULL,
  ADD COLUMN `exaHttp` int NULL;
