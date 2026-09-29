-- The two profile fields that sit beside the user's full name.
--
-- `preferredName` is the form of address ("how should we call you") and is deliberately a separate
-- column from `name`: they answer different questions, and folding them into one column is what
-- made the profile show the same value twice. `personalPreferences` holds the free-text
-- preferences the user asked us to honour.
--
-- Both are nullable and additive, so an existing row needs no backfill: absent means "not set yet"
-- and the profile renders an empty field. Neither column is read into a system prompt or a chat
-- request; they are profile data only.
--
-- Both columns are added by one statement on purpose. This migrator hands the file to the driver as
-- a single statement, so two stacked ALTER TABLEs were rejected by MySQL with ER_PARSE_ERROR.
ALTER TABLE `users`
  ADD `preferredName` text,
  ADD `personalPreferences` text;
