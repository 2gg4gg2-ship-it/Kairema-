-- Per-role Kairema request allowance.
--
-- `chat_stream_rate_windows` used to hold one row per user, so the four Kairema roles shared a
-- single counter: spending a full window on Flash also throttled Think, Context and Apex. The role
-- slug becomes part of the primary key, so each role is metered independently and switching roles
-- never consumes or inherits another role's remaining allowance.
--
-- The key is the stable role slug (`fast`, `smart`, `context`, `flagship`) rather than the model
-- behind it, so re-pointing a role at a different LLM keeps counting the same bucket.
--
-- Existing rows predate the per-role split, so their single historical counter is attributed to
-- `fast` and expires on its own within the existing 60-second window; no data is dropped and no
-- user's chat history, settings or identity is touched. The My API (BYOK) budget in
-- `my_api_rate_windows` is a separate table and is deliberately left alone.
--
-- Everything happens in one statement: this migrator hands the file to the driver as a single
-- statement, and stacked ALTER TABLEs were rejected by MySQL with ER_PARSE_ERROR in 0049.
ALTER TABLE `chat_stream_rate_windows`
  ADD COLUMN `roleId` varchar(24) NOT NULL DEFAULT 'fast' AFTER `userId`,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (`userId`, `roleId`);
