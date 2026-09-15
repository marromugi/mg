CREATE TABLE IF NOT EXISTS `spans` (
	`session_id` text NOT NULL,
	`service_name` text NOT NULL,
	`trace_id` text NOT NULL,
	`span_id` text PRIMARY KEY NOT NULL,
	`parent_span_id` text,
	`name` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`attributes` text NOT NULL,
	`events` text NOT NULL,
	`status_code` integer NOT NULL,
	`status_message` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `spans_session_id_idx` ON `spans` (`session_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `spans_trace_id_idx` ON `spans` (`trace_id`);