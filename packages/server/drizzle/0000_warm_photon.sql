CREATE TABLE `agent_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`metadata` text DEFAULT '{}',
	`project_id` text,
	`message_id` text,
	`timestamp` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_skills` (
	`registry_entry_id` text NOT NULL,
	`skill_id` text NOT NULL,
	PRIMARY KEY(`registry_entry_id`, `skill_id`)
);
--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`registry_entry_id` text,
	`role` text NOT NULL,
	`parent_id` text,
	`status` text DEFAULT 'idle' NOT NULL,
	`model` text NOT NULL,
	`provider` text NOT NULL,
	`base_url` text,
	`temperature` integer,
	`system_prompt` text,
	`model_pack_id` text,
	`gear_config` text,
	`project_id` text,
	`workspace_path` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `calendar_events` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`location` text,
	`start` text NOT NULL,
	`end` text NOT NULL,
	`all_day` integer DEFAULT false NOT NULL,
	`recurrence` text DEFAULT 'null',
	`color` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`project_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `custom_models` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`label` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `custom_tools` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`parameters` text DEFAULT '[]' NOT NULL,
	`code` text NOT NULL,
	`timeout` integer DEFAULT 30000 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_tools_name_unique` ON `custom_tools` (`name`);--> statement-breakpoint
CREATE TABLE `kanban_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`column` text DEFAULT 'backlog' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`assignee_agent_id` text,
	`created_by` text,
	`labels` text DEFAULT '[]' NOT NULL,
	`blocked_by` text DEFAULT '[]' NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`completion_report` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`from_agent_id` text,
	`to_agent_id` text,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`metadata` text DEFAULT '{}',
	`project_id` text,
	`conversation_id` text,
	`correlation_id` text,
	`timestamp` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_tokens` (
	`provider` text NOT NULL,
	`account_id` text NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text,
	`expires_at` text,
	`scopes` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`charter` text,
	`charter_status` text DEFAULT 'gathering',
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`api_key` text,
	`base_url` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `registry_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`system_prompt` text NOT NULL,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`default_model` text NOT NULL,
	`default_provider` text NOT NULL,
	`tools` text DEFAULT '[]' NOT NULL,
	`built_in` integer DEFAULT false NOT NULL,
	`role` text DEFAULT 'worker' NOT NULL,
	`model_pack_id` text,
	`gear_config` text,
	`prompt_addendum` text,
	`cloned_from_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`version` text DEFAULT '1.0.0' NOT NULL,
	`author` text DEFAULT '' NOT NULL,
	`tools` text DEFAULT '[]' NOT NULL,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`parameters` text DEFAULT '{}' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'created' NOT NULL,
	`cloned_from_id` text,
	`scan_status` text DEFAULT 'unscanned' NOT NULL,
	`scan_findings` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `todos` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`due_date` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `token_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cost` integer,
	`project_id` text,
	`conversation_id` text,
	`message_id` text,
	`timestamp` text NOT NULL
);
