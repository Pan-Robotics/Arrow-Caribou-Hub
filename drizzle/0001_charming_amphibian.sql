CREATE TABLE `apiKeys` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(64) NOT NULL,
	`droneId` varchar(64) NOT NULL,
	`description` text,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `apiKeys_id` PRIMARY KEY(`id`),
	CONSTRAINT `apiKeys_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `appData` (
	`id` int AUTO_INCREMENT NOT NULL,
	`appId` varchar(64) NOT NULL,
	`data` json NOT NULL,
	`rawPayload` json,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `appData_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `appVersions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`appId` varchar(64) NOT NULL,
	`version` varchar(32) NOT NULL,
	`parserCode` text NOT NULL,
	`dataSchema` text NOT NULL,
	`uiSchema` text,
	`name` varchar(255) NOT NULL,
	`description` text,
	`creatorId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `appVersions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `customApps` (
	`id` int AUTO_INCREMENT NOT NULL,
	`appId` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`icon` varchar(512),
	`dataSource` enum('custom_endpoint','stream_subscription','passthrough') NOT NULL DEFAULT 'custom_endpoint',
	`dataSourceConfig` text,
	`parserCode` text NOT NULL,
	`dataSchema` text NOT NULL,
	`uiSchema` text,
	`version` varchar(32) NOT NULL DEFAULT '1.0.0',
	`published` enum('draft','published') NOT NULL DEFAULT 'draft',
	`creatorId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customApps_id` PRIMARY KEY(`id`),
	CONSTRAINT `customApps_appId_unique` UNIQUE(`appId`)
);
--> statement-breakpoint
CREATE TABLE `droneFiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`fileId` varchar(64) NOT NULL,
	`filename` varchar(255) NOT NULL,
	`mimeType` varchar(128),
	`fileSize` int NOT NULL,
	`storageKey` varchar(512) NOT NULL,
	`url` varchar(1024) NOT NULL,
	`droneId` varchar(64),
	`description` text,
	`uploadedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `droneFiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `droneFiles_fileId_unique` UNIQUE(`fileId`)
);
--> statement-breakpoint
CREATE TABLE `droneJobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`droneId` varchar(64) NOT NULL,
	`type` varchar(64) NOT NULL,
	`payload` json NOT NULL,
	`status` enum('pending','in_progress','completed','failed','expired') NOT NULL DEFAULT 'pending',
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`acknowledgedAt` timestamp,
	`completedAt` timestamp,
	`createdBy` int NOT NULL,
	`retryCount` int NOT NULL DEFAULT 0,
	`maxRetries` int NOT NULL DEFAULT 3,
	`timeoutSeconds` int NOT NULL DEFAULT 300,
	`expiresAt` timestamp,
	`lockedBy` varchar(128),
	CONSTRAINT `droneJobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `drones` (
	`id` int AUTO_INCREMENT NOT NULL,
	`droneId` varchar(64) NOT NULL,
	`name` text,
	`lastSeen` timestamp NOT NULL DEFAULT (now()),
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `drones_id` PRIMARY KEY(`id`),
	CONSTRAINT `drones_droneId_unique` UNIQUE(`droneId`)
);
--> statement-breakpoint
CREATE TABLE `fcLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`droneId` varchar(64) NOT NULL,
	`remotePath` varchar(512) NOT NULL,
	`filename` varchar(255) NOT NULL,
	`fileSize` int,
	`status` enum('discovered','downloading','uploading','completed','failed') NOT NULL DEFAULT 'discovered',
	`progress` int DEFAULT 0,
	`storageKey` varchar(512),
	`url` varchar(1024),
	`errorMessage` text,
	`discoveredAt` timestamp NOT NULL DEFAULT (now()),
	`downloadedAt` timestamp,
	`sha256Hash` varchar(64),
	CONSTRAINT `fcLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `firmwareUpdates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`droneId` varchar(64) NOT NULL,
	`filename` varchar(255) NOT NULL,
	`fileSize` int NOT NULL,
	`storageKey` varchar(512) NOT NULL,
	`url` varchar(1024) NOT NULL,
	`status` enum('uploaded','queued','transferring','flashing','verifying','completed','failed') NOT NULL DEFAULT 'uploaded',
	`flashStage` varchar(64),
	`progress` int DEFAULT 0,
	`errorMessage` text,
	`initiatedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`startedAt` timestamp,
	`completedAt` timestamp,
	`sha256Hash` varchar(64),
	`firmwareVersion` varchar(128),
	CONSTRAINT `firmwareUpdates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `flightLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`droneId` varchar(64) NOT NULL,
	`filename` varchar(255) NOT NULL,
	`fileSize` int NOT NULL,
	`storageKey` varchar(512) NOT NULL,
	`url` varchar(1024) NOT NULL,
	`format` enum('bin','log') NOT NULL,
	`description` text,
	`notesUrl` varchar(1024),
	`mediaUrls` json,
	`uploadSource` enum('manual','api') NOT NULL DEFAULT 'manual',
	`uploadedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `flightLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`droneId` varchar(64) NOT NULL,
	`timestamp` timestamp NOT NULL,
	`pointCount` int NOT NULL,
	`minDistance` int,
	`maxDistance` int,
	`avgQuality` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `systemDiagnostics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`droneId` varchar(64) NOT NULL,
	`cpuPercent` int,
	`memoryPercent` int,
	`diskPercent` int,
	`cpuTempC` int,
	`uptimeSeconds` int,
	`services` json,
	`network` json,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `systemDiagnostics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `telemetry` (
	`id` int AUTO_INCREMENT NOT NULL,
	`droneId` varchar(64) NOT NULL,
	`timestamp` timestamp NOT NULL,
	`telemetryData` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `telemetry_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `userApps` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`appId` varchar(64) NOT NULL,
	`installedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `userApps_id` PRIMARY KEY(`id`)
);
