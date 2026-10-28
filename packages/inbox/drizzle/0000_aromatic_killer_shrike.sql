CREATE TABLE `inbox_items` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`input` text NOT NULL,
	`due_at` integer NOT NULL,
	`added_at` integer NOT NULL,
	`outcome` text,
	`reason` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbox_items_id_unique` ON `inbox_items` (`id`);