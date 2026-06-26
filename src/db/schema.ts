import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { config } from '../config/settings';

let _db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (_db) return _db;

  const dbPath = config.database.path;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  _db = new DatabaseSync(dbPath);
  _db.exec('PRAGMA journal_mode = WAL');
  _db.exec('PRAGMA foreign_keys = ON');
  migrate(_db);
  return _db;
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id                    TEXT PRIMARY KEY,
      first_name            TEXT NOT NULL DEFAULT '',
      last_name             TEXT NOT NULL DEFAULT '',
      restaurant_name       TEXT NOT NULL DEFAULT '',
      phone                 TEXT NOT NULL UNIQUE,
      email                 TEXT NOT NULL DEFAULT '',
      website               TEXT NOT NULL DEFAULT '',
      street_address        TEXT NOT NULL DEFAULT '',
      city                  TEXT NOT NULL DEFAULT '',
      state                 TEXT NOT NULL DEFAULT '',
      postal_code           TEXT NOT NULL DEFAULT '',
      country               TEXT NOT NULL DEFAULT 'United States',
      timezone              TEXT NOT NULL DEFAULT 'America/New_York',
      google_reviews_count  INTEGER NOT NULL DEFAULT 0,
      google_maps_url       TEXT NOT NULL DEFAULT '',
      status                TEXT NOT NULL DEFAULT 'pending',
      attempt_count         INTEGER NOT NULL DEFAULT 0,
      last_attempted_at     TEXT,
      created_at            TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS call_attempts (
      id                TEXT PRIMARY KEY,
      lead_id           TEXT NOT NULL REFERENCES leads(id),
      attempt_number    INTEGER NOT NULL DEFAULT 1,
      scheduled_at      TEXT,
      started_at        TEXT NOT NULL,
      ended_at          TEXT,
      duration_seconds  INTEGER,
      status            TEXT NOT NULL,
      provider          TEXT NOT NULL DEFAULT 'mock',
      transcript        TEXT,
      raw_provider_data TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS call_results (
      id                        TEXT PRIMARY KEY,
      call_attempt_id           TEXT NOT NULL REFERENCES call_attempts(id),
      lead_id                   TEXT NOT NULL REFERENCES leads(id),

      was_answered              INTEGER NOT NULL DEFAULT 0,
      rings_before_answer       INTEGER,
      had_professional_greeting INTEGER NOT NULL DEFAULT 0,
      restaurant_name_mentioned INTEGER NOT NULL DEFAULT 0,
      put_on_hold               INTEGER NOT NULL DEFAULT 0,
      hold_duration_seconds     INTEGER,
      could_take_order          INTEGER NOT NULL DEFAULT 0,
      order_confirmed           INTEGER NOT NULL DEFAULT 0,
      upsell_attempted          INTEGER NOT NULL DEFAULT 0,
      estimated_wait_time       TEXT,
      staff_friendliness        TEXT NOT NULL DEFAULT 'neutral',
      call_resolved             INTEGER NOT NULL DEFAULT 0,
      issues                    TEXT NOT NULL DEFAULT '[]',
      extraction_notes          TEXT NOT NULL DEFAULT '',

      score_pickup              REAL NOT NULL DEFAULT 0,
      score_greeting            REAL NOT NULL DEFAULT 0,
      score_responsiveness      REAL NOT NULL DEFAULT 0,
      score_order_capability    REAL NOT NULL DEFAULT 0,
      score_accuracy            REAL NOT NULL DEFAULT 0,
      score_friendliness        REAL NOT NULL DEFAULT 0,
      score_overall             REAL NOT NULL DEFAULT 0,

      sdr_signal                TEXT NOT NULL DEFAULT 'cold',
      sdr_notes                 TEXT NOT NULL DEFAULT '',

      extracted_at              TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_leads_status    ON leads(status);
    CREATE INDEX IF NOT EXISTS idx_leads_phone     ON leads(phone);
    CREATE INDEX IF NOT EXISTS idx_attempts_lead   ON call_attempts(lead_id);
    CREATE INDEX IF NOT EXISTS idx_results_lead    ON call_results(lead_id);
    CREATE INDEX IF NOT EXISTS idx_results_signal  ON call_results(sdr_signal);
  `);
}
