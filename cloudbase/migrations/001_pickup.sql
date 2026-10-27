-- MySQL 8.0+ / InnoDB. Apply once to a dedicated, empty schema using an administrator.
-- DDL is intentionally not exposed by the public API. No DROP, TRUNCATE or roster replacement.
CREATE TABLE IF NOT EXISTS pickup_schema_versions (
  version INT PRIMARY KEY, applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  _openid VARCHAR(64) NOT NULL DEFAULT ''
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS pickup_control (
  id TINYINT PRIMARY KEY, next_number INT NOT NULL DEFAULT 1, revision BIGINT NOT NULL DEFAULT 0,
  _openid VARCHAR(64) NOT NULL DEFAULT '', CHECK (id = 1), CHECK (next_number > 0)
) ENGINE=InnoDB;
INSERT IGNORE INTO pickup_control (id) VALUES (1);
CREATE TABLE IF NOT EXISTS pickup_roster (
  id TINYINT PRIMARY KEY, version VARCHAR(128) NOT NULL, content_hash CHAR(64) NOT NULL,
  person_count INT NOT NULL, is_demo BOOLEAN NOT NULL, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  _openid VARCHAR(64) NOT NULL DEFAULT '', CHECK (id = 1)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS pickup_people (
  id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  name VARCHAR(128) NOT NULL, company VARCHAR(512) NOT NULL, source_json JSON NOT NULL,
  roster_order INT NOT NULL UNIQUE, assignment_version INT NOT NULL DEFAULT 0,
  _openid VARCHAR(64) NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS pickup_tickets (
  number INT PRIMARY KEY, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  _openid VARCHAR(64) NOT NULL DEFAULT '', CHECK (number > 0)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS pickup_assignments (
  person_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  ticket_number INT NOT NULL, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  _openid VARCHAR(64) NOT NULL DEFAULT '', INDEX idx_ticket (ticket_number, person_id),
  FOREIGN KEY (person_id) REFERENCES pickup_people(id), FOREIGN KEY (ticket_number) REFERENCES pickup_tickets(number)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS pickup_requests (
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  payload_hash CHAR(64) NOT NULL, operation VARCHAR(16) NOT NULL, result_json JSON NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  _openid VARCHAR(64) NOT NULL DEFAULT ''
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS pickup_audit (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operation VARCHAR(16) NOT NULL, changes_json JSON NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  _openid VARCHAR(64) NOT NULL DEFAULT '', INDEX idx_request (request_id),
  FOREIGN KEY (request_id) REFERENCES pickup_requests(request_id)
) ENGINE=InnoDB;
INSERT IGNORE INTO pickup_schema_versions (version) VALUES (1);
