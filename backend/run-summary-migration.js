"use strict";

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { Pool } = require("pg");

dotenv.config();
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
});

async function migrate() {
    try {
        const migrationDirectory = path.join(__dirname, "migrations");
        const migrationFiles = fs.readdirSync(migrationDirectory).filter(file => /^\d+_.*\.sql$/.test(file)).sort();
        for (const migrationFile of migrationFiles) {
            await pool.query(fs.readFileSync(path.join(migrationDirectory, migrationFile), "utf8"));
        }
        console.log("Phase 2 summary migration applied successfully.");
        const columns = await pool.query(
            "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'conversation_summaries' ORDER BY ordinal_position"
        );
        console.table(columns.rows);
    } finally {
        await pool.end();
    }
}

migrate().catch(error => {
    console.error("Summary migration failed:", error.message);
    process.exitCode = 1;
});
