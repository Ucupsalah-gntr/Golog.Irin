CREATE TABLE `audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`actorId` int NOT NULL,
	`action` varchar(80) NOT NULL,
	`entityType` varchar(80) NOT NULL,
	`entityId` int,
	`beforeData` json,
	`afterData` json,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sku` varchar(64) NOT NULL,
	`name` varchar(180) NOT NULL,
	`category` varchar(100),
	`unit` varchar(32) NOT NULL,
	`sourceWarehouseId` int,
	`minStock` int NOT NULL DEFAULT 0,
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `items_id` PRIMARY KEY(`id`),
	CONSTRAINT `items_sku_unique` UNIQUE(`sku`)
);
--> statement-breakpoint
CREATE TABLE `request_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requestId` int NOT NULL,
	`itemId` int NOT NULL,
	`requestedQty` int NOT NULL,
	`approvedQty` int NOT NULL DEFAULT 0,
	`deliveredQty` int NOT NULL DEFAULT 0,
	CONSTRAINT `request_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requestNo` varchar(40) NOT NULL,
	`roomId` int NOT NULL,
	`createdBy` int NOT NULL,
	`priority` enum('normal','mendesak','darurat') NOT NULL DEFAULT 'normal',
	`status` enum('draft','submitted','approved','partial','rejected','ready','delivered','received','cancelled') NOT NULL DEFAULT 'draft',
	`notes` text,
	`submittedAt` timestamp,
	`verifiedAt` timestamp,
	`deliveredAt` timestamp,
	`receivedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `requests_requestNo_unique` UNIQUE(`requestNo`)
);
--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(32) NOT NULL,
	`name` varchar(120) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `rooms_id` PRIMARY KEY(`id`),
	CONSTRAINT `rooms_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `stock_adjustments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`adjustmentNo` varchar(40) NOT NULL,
	`itemId` int NOT NULL,
	`roomId` int,
	`adjustmentType` enum('add','subtract') NOT NULL,
	`quantity` int NOT NULL,
	`systemQty` int NOT NULL,
	`physicalQty` int NOT NULL,
	`reasonType` enum('forgotten_entry','holiday_pickup','damaged','expired','emergency','stocktake','other') NOT NULL,
	`reason` text NOT NULL,
	`incidentDate` timestamp NOT NULL,
	`status` enum('draft','applied','rejected') NOT NULL DEFAULT 'draft',
	`createdBy` int NOT NULL,
	`verifiedBy` int,
	`appliedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `stock_adjustments_id` PRIMARY KEY(`id`),
	CONSTRAINT `stock_adjustments_adjustmentNo_unique` UNIQUE(`adjustmentNo`)
);
--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`itemId` int NOT NULL,
	`movementType` enum('in','out','adjustment') NOT NULL,
	`quantity` int NOT NULL,
	`sourceWarehouseId` int,
	`roomId` int,
	`requestId` int,
	`adjustmentId` int,
	`notes` text,
	`occurredAt` timestamp NOT NULL DEFAULT (now()),
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `stock_movements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `warehouses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(32) NOT NULL,
	`name` varchar(120) NOT NULL,
	`kind` enum('source','logistics') NOT NULL DEFAULT 'source',
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `warehouses_id` PRIMARY KEY(`id`),
	CONSTRAINT `warehouses_code_unique` UNIQUE(`code`)
);
