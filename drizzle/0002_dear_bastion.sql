CREATE TABLE `remote_session_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`sender` text NOT NULL,
	`candidate` text NOT NULL,
	`sdp_mid` text,
	`sdp_m_line_index` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `remote_candidates_session_sender_idx` ON `remote_session_candidates` (`session_id`,`sender`,`created_at`);