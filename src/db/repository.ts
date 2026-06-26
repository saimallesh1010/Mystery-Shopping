import { v4 as uuidv4 } from 'uuid';
import { getDb } from './schema';
import type {
  Lead,
  LeadStatus,
  CallAttempt,
  CallStatus,
  Extraction,
  Scores,
  SdrSignal,
} from '../types';

// ─── Leads ────────────────────────────────────────────────────────────────────

export function upsertLead(
  data: Omit<Lead, 'id' | 'status' | 'attempt_count' | 'last_attempted_at' | 'created_at' | 'updated_at'>
): Lead {
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM leads WHERE phone = ?')
    .get(data.phone) as unknown as Lead | undefined;

  if (existing) {
    db.prepare(`
      UPDATE leads SET
        first_name = ?, last_name = ?, restaurant_name = ?, email = ?,
        website = ?, street_address = ?, city = ?, state = ?, postal_code = ?,
        country = ?, timezone = ?, google_reviews_count = ?, google_maps_url = ?,
        updated_at = datetime('now')
      WHERE phone = ?
    `).run(
      data.first_name, data.last_name, data.restaurant_name, data.email,
      data.website, data.street_address, data.city, data.state, data.postal_code,
      data.country, data.timezone, data.google_reviews_count, data.google_maps_url,
      data.phone
    );
    return db.prepare('SELECT * FROM leads WHERE phone = ?').get(data.phone) as unknown as Lead;
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO leads
      (id, first_name, last_name, restaurant_name, phone, email, website,
       street_address, city, state, postal_code, country, timezone,
       google_reviews_count, google_maps_url)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, data.first_name, data.last_name, data.restaurant_name, data.phone,
    data.email, data.website, data.street_address, data.city, data.state,
    data.postal_code, data.country, data.timezone,
    data.google_reviews_count, data.google_maps_url
  );

  return db.prepare('SELECT * FROM leads WHERE id = ?').get(id) as unknown as Lead;
}

export function getLeadsByStatus(status: LeadStatus): Lead[] {
  return getDb()
    .prepare('SELECT * FROM leads WHERE status = ? ORDER BY created_at ASC')
    .all(status) as unknown as Lead[];
}

export function getLeadsForRetry(retryDelayHours: number): Lead[] {
  return getDb().prepare(`
    SELECT * FROM leads
    WHERE status = 'retry'
      AND (last_attempted_at IS NULL
           OR datetime(last_attempted_at, '+' || ? || ' hours') <= datetime('now'))
    ORDER BY last_attempted_at ASC
  `).all(retryDelayHours) as unknown as Lead[];
}

export function updateLeadStatus(
  id: string,
  status: LeadStatus,
  extras: { attempt_count?: number; last_attempted_at?: string } = {}
): void {
  const db = getDb();
  if (extras.attempt_count !== undefined && extras.last_attempted_at) {
    db.prepare(`
      UPDATE leads SET status = ?, attempt_count = ?, last_attempted_at = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(status, extras.attempt_count, extras.last_attempted_at, id);
  } else {
    db.prepare(`
      UPDATE leads SET status = ?, updated_at = datetime('now') WHERE id = ?
    `).run(status, id);
  }
}

export function countLeads(): { total: number; byStatus: Record<string, number> } {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) as n FROM leads').get() as unknown as { n: number }).n;
  const rows = db.prepare('SELECT status, COUNT(*) as n FROM leads GROUP BY status').all() as
    unknown as { status: string; n: number }[];
  const byStatus: Record<string, number> = {};
  for (const row of rows) byStatus[row.status] = row.n;
  return { total, byStatus };
}

// ─── Call Attempts ─────────────────────────────────────────────────────────────

export function createCallAttempt(data: Omit<CallAttempt, 'id' | 'created_at'>): CallAttempt {
  const db = getDb();
  const id = uuidv4();
  db.prepare(`
    INSERT INTO call_attempts
      (id, lead_id, attempt_number, scheduled_at, started_at, ended_at,
       duration_seconds, status, provider, transcript, raw_provider_data)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, data.lead_id, data.attempt_number, data.scheduled_at ?? null,
    data.started_at, data.ended_at ?? null, data.duration_seconds ?? null,
    data.status, data.provider, data.transcript ?? null,
    data.raw_provider_data ? JSON.stringify(data.raw_provider_data) : null
  );
  return db.prepare('SELECT * FROM call_attempts WHERE id = ?').get(id) as unknown as CallAttempt;
}

export function updateCallAttempt(
  id: string,
  updates: Partial<Pick<CallAttempt, 'ended_at' | 'duration_seconds' | 'status' | 'transcript'>>
): void {
  const db = getDb();
  const fields = Object.keys(updates)
    .map(k => `${k} = ?`)
    .join(', ');
  const values = [...Object.values(updates), id];
  db.prepare(`UPDATE call_attempts SET ${fields} WHERE id = ?`).run(...values);
}

export function getAttemptsByLead(leadId: string): CallAttempt[] {
  return getDb()
    .prepare('SELECT * FROM call_attempts WHERE lead_id = ? ORDER BY created_at DESC')
    .all(leadId) as unknown as CallAttempt[];
}

// ─── Call Results ──────────────────────────────────────────────────────────────

export function saveCallResult(
  callAttemptId: string,
  leadId: string,
  extraction: Extraction,
  scores: Scores,
  sdrSignal: SdrSignal,
  sdrNotes: string
): void {
  const db = getDb();
  const id = uuidv4();
  db.prepare(`
    INSERT INTO call_results (
      id, call_attempt_id, lead_id,
      was_answered, rings_before_answer, had_professional_greeting, restaurant_name_mentioned,
      put_on_hold, hold_duration_seconds, could_take_order, order_confirmed,
      upsell_attempted, estimated_wait_time, staff_friendliness, call_resolved,
      issues, extraction_notes,
      score_pickup, score_greeting, score_responsiveness, score_order_capability,
      score_accuracy, score_friendliness, score_overall,
      sdr_signal, sdr_notes
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, callAttemptId, leadId,
    extraction.was_answered ? 1 : 0,
    extraction.rings_before_answer ?? null,
    extraction.had_professional_greeting ? 1 : 0,
    extraction.restaurant_name_mentioned ? 1 : 0,
    extraction.put_on_hold ? 1 : 0,
    extraction.hold_duration_seconds ?? null,
    extraction.could_take_order ? 1 : 0,
    extraction.order_confirmed ? 1 : 0,
    extraction.upsell_attempted ? 1 : 0,
    extraction.estimated_wait_time ?? null,
    extraction.staff_friendliness,
    extraction.call_resolved ? 1 : 0,
    JSON.stringify(extraction.issues),
    extraction.notes,
    scores.pickup, scores.greeting, scores.responsiveness,
    scores.order_capability, scores.accuracy, scores.friendliness, scores.overall,
    sdrSignal, sdrNotes
  );
}

export interface ResultRow {
  id: string;
  lead_id: string;
  restaurant_name: string;
  phone: string;
  city: string;
  state: string;
  call_attempt_id: string;
  call_status: CallStatus;
  duration_seconds: number | null;
  transcript: string | null;
  was_answered: number;
  rings_before_answer: number | null;
  had_professional_greeting: number;
  restaurant_name_mentioned: number;
  put_on_hold: number;
  hold_duration_seconds: number | null;
  could_take_order: number;
  order_confirmed: number;
  upsell_attempted: number;
  estimated_wait_time: string | null;
  staff_friendliness: string;
  call_resolved: number;
  issues: string;
  extraction_notes: string;
  score_pickup: number;
  score_greeting: number;
  score_responsiveness: number;
  score_order_capability: number;
  score_accuracy: number;
  score_friendliness: number;
  score_overall: number;
  sdr_signal: string;
  sdr_notes: string;
  extracted_at: string;
}

export function getAllResults(): ResultRow[] {
  return getDb().prepare(`
    SELECT
      cr.*,
      l.restaurant_name, l.phone, l.city, l.state,
      ca.status AS call_status, ca.duration_seconds, ca.transcript
    FROM call_results cr
    JOIN leads l ON l.id = cr.lead_id
    JOIN call_attempts ca ON ca.id = cr.call_attempt_id
    ORDER BY cr.score_overall ASC
  `).all() as unknown as ResultRow[];
}

export function getResultsBySignal(signal: SdrSignal): ResultRow[] {
  return getDb().prepare(`
    SELECT
      cr.*,
      l.restaurant_name, l.phone, l.city, l.state,
      ca.status AS call_status, ca.duration_seconds, ca.transcript
    FROM call_results cr
    JOIN leads l ON l.id = cr.lead_id
    JOIN call_attempts ca ON ca.id = cr.call_attempt_id
    WHERE cr.sdr_signal = ?
    ORDER BY cr.score_overall ASC
  `).all(signal) as unknown as ResultRow[];
}
