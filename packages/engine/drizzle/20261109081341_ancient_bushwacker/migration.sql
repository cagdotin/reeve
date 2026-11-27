CREATE TABLE `payees_apart` (
	`payee_id` text NOT NULL,
	`other_id` text NOT NULL,
	CONSTRAINT `payees_apart_pk` PRIMARY KEY(`payee_id`, `other_id`),
	CONSTRAINT `fk_payees_apart_payee_id_payees_id_fk` FOREIGN KEY (`payee_id`) REFERENCES `payees`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_payees_apart_other_id_payees_id_fk` FOREIGN KEY (`other_id`) REFERENCES `payees`(`id`) ON DELETE CASCADE
);
