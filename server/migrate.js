import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigrations() {
  const migrationsDir = path.join(__dirname, 'migrations');

  try {
    // Make sure pgcrypto exists (needed for gen_random_uuid())
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

    // Read all .sql files and run in sorted order
    const files = fs
      .readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort(); // 001_, 002_, etc.

    if (files.length === 0) {
      console.log('No migration files found.');
      process.exit(0);
    }

    console.log('Running migrations:', files.join(', '));

    for (const file of files) {
      const fullPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(fullPath, 'utf8');

      console.log(`\n➡️  Applying ${file}...`);
      await pool.query(sql);
      console.log(`✅ Applied ${file}`);
    }

    console.log('\n✅ All migrations completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigrations();