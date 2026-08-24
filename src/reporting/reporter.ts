import { getAllResults, getResultsBySignal, countLeads } from '../db/repository';
import type { ResultRow } from '../db/repository';

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN  = '\x1b[32m';
const CYAN   = '\x1b[36m';
const DIM    = '\x1b[2m';

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

function signalColor(signal: string): string {
  if (signal === 'hot')  return RED;
  if (signal === 'warm') return YELLOW;
  return GREEN;
}

function overallBar(score: number): string {
  const filled = Math.round(score / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

export function printFullReport(): void {
  const { total, byStatus } = countLeads();
  const results = getAllResults();

  const hot  = results.filter(r => r.sdr_signal === 'hot').length;
  const warm = results.filter(r => r.sdr_signal === 'warm').length;
  const cold = results.filter(r => r.sdr_signal === 'cold').length;

  console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}║          MYSTERY SHOPPING REPORT                                    ║${RESET}`);
  console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════════════════════════════╝${RESET}\n`);

  // Summary
  console.log(`${BOLD}LEAD SUMMARY${RESET}`);
  console.log(`  Total leads imported : ${total}`);
  console.log(`  Completed calls      : ${byStatus['completed'] ?? 0}`);
  console.log(`  Pending              : ${byStatus['pending'] ?? 0}`);
  console.log(`  Scheduled for retry  : ${byStatus['retry'] ?? 0}`);
  console.log(`  Failed               : ${byStatus['failed'] ?? 0}`);
  console.log('');
  console.log(`  ${RED}${BOLD}HOT${RESET}  prospects : ${hot}   ${DIM}(call these first — strongest opportunity)${RESET}`);
  console.log(`  ${YELLOW}${BOLD}WARM${RESET} prospects : ${warm}   ${DIM}(worth outreach)${RESET}`);
  console.log(`  ${GREEN}${BOLD}COLD${RESET} prospects : ${cold}   ${DIM}(already decent, lower priority)${RESET}`);

  if (results.length === 0) {
    console.log('\n  No call results yet. Run: npm run run-calls\n');
    return;
  }

  console.log('');
  printResultTable('HOT PROSPECTS', results.filter(r => r.sdr_signal === 'hot'), RED);
  printResultTable('WARM PROSPECTS', results.filter(r => r.sdr_signal === 'warm'), YELLOW);
  printResultTable('COLD PROSPECTS', results.filter(r => r.sdr_signal === 'cold'), GREEN);

  // Score breakdown for all completed calls
  if (results.length > 0) {
    printScoreBreakdown(results);
  }
}

function printResultTable(title: string, rows: ResultRow[], color: string): void {
  if (rows.length === 0) return;

  console.log(`${color}${BOLD}${title}${RESET} (${rows.length})`);
  console.log(`${DIM}${'─'.repeat(90)}${RESET}`);

  const header =
    `${BOLD}${pad('Restaurant', 28)}${pad('Phone', 16)}${pad('City/ST', 16)}${pad('Score', 7)}${pad('Status', 12)}Notes${RESET}`;
  console.log(header);
  console.log(`${DIM}${'─'.repeat(90)}${RESET}`);

  for (const r of rows) {
    const location = `${r.city}, ${r.state}`.slice(0, 15);
    const score = r.was_answered ? `${Math.round(r.score_overall)}/100` : '—';
    const status = r.call_status.replace('_', ' ');
    const notes = r.sdr_notes.slice(0, 40);

    console.log(
      `${color}${pad(r.restaurant_name, 28)}${RESET}` +
      `${pad(formatPhone(r.phone), 16)}` +
      `${pad(location, 16)}` +
      `${color}${pad(score, 7)}${RESET}` +
      `${pad(status, 12)}` +
      `${DIM}${notes}${RESET}`
    );
  }
  console.log('');
}

function printScoreBreakdown(rows: ResultRow[]): void {
  const answered = rows.filter(r => r.was_answered);
  if (answered.length === 0) return;

  console.log(`${BOLD}SCORE BREAKDOWN (answered calls)${RESET}`);
  console.log(`${DIM}${'─'.repeat(60)}${RESET}`);

  for (const r of answered) {
    const bar = overallBar(r.score_overall);
    const issues = JSON.parse(r.issues ?? '[]') as string[];
    console.log(
      `  ${BOLD}${pad(r.restaurant_name, 26)}${RESET} ` +
      `${signalColor(r.sdr_signal)}${bar}${RESET} ${Math.round(r.score_overall)}`
    );
    if (issues.length > 0) {
      console.log(`  ${DIM}  Issues: ${issues.join(' · ')}${RESET}`);
    }
  }
  console.log('');
}

function formatPhone(digits: string): string {
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return digits;
}

export function printJsonReport(): void {
  const results = getAllResults();
  const output = results.map(r => ({
    restaurant: r.restaurant_name,
    phone: formatPhone(r.phone),
    location: `${r.city}, ${r.state}`,
    call_status: r.call_status,
    sdr_signal: r.sdr_signal,
    sdr_notes: r.sdr_notes,
    scores: {
      overall: Math.round(r.score_overall),
      pickup: r.score_pickup,
      greeting: r.score_greeting,
      responsiveness: r.score_responsiveness,
      order_capability: r.score_order_capability,
      accuracy: r.score_accuracy,
      friendliness: r.score_friendliness,
    },
    extraction: {
      was_answered: Boolean(r.was_answered),
      rings_before_answer: r.rings_before_answer,
      professional_greeting: Boolean(r.had_professional_greeting),
      restaurant_name_mentioned: Boolean(r.restaurant_name_mentioned),
      put_on_hold: Boolean(r.put_on_hold),
      hold_duration_s: r.hold_duration_seconds,
      could_take_order: Boolean(r.could_take_order),
      order_confirmed: Boolean(r.order_confirmed),
      upsell_attempted: Boolean(r.upsell_attempted),
      estimated_wait_time: r.estimated_wait_time,
      staff_friendliness: r.staff_friendliness,
      issues: JSON.parse(r.issues ?? '[]'),
    },
    transcript_excerpt: (r.transcript ?? '').split('\n').slice(0, 5).join('\n'),
    called_at: r.extracted_at,
  }));

  console.log(JSON.stringify(output, null, 2));
}
