-- ShrimpGuard MySQL schema
-- Import this file with a MySQL account that can create databases.

CREATE DATABASE IF NOT EXISTS shrimpguard_users
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE shrimpguard_users;

CREATE TABLE IF NOT EXISTS users (
    name VARCHAR(80) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'Active',
    last_login DATETIME NULL,
    PRIMARY KEY (email),
    UNIQUE KEY uq_users_name (name),
    UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS roles (
    id INT NOT NULL AUTO_INCREMENT,
    role_name VARCHAR(50) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_roles_role_name (role_name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sensors (
    ph_level FLOAT NOT NULL,
    temperature FLOAT NOT NULL,
    `date` VARCHAR(45) NOT NULL,
    status VARCHAR(45) NOT NULL
) ENGINE=InnoDB;
