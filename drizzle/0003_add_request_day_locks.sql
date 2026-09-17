CREATE TABLE `request_day_locks` (
  `id` int AUTO_INCREMENT NOT NULL,
  `roomId` int NOT NULL,
  `requestDate` varchar(10) NOT NULL,
  `requesterId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `request_day_locks_pk` PRIMARY KEY (`id`),
  CONSTRAINT `request_day_locks_room_date_unique` UNIQUE (`roomId`, `requestDate`)
);
