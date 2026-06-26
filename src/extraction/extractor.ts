import OpenAI from 'openai';
import { config } from '../config/settings';
import type { Extraction, CallStatus, StaffFriendliness } from '../types';

let _openai: OpenAI | null = null;

function getOpenAI(): OpenAI | null {
  if (!config.openai.apiKey) return null;
  if (!_openai) _openai = new OpenAI({ apiKey: config.openai.apiKey });
  return _openai;
}

export async function extractFromTranscript(
  transcript: string,
  callStatus: CallStatus
): Promise<Extraction> {
  const client = getOpenAI();
  if (client) {
    try {
      return await extractWithLLM(client, transcript, callStatus);
    } catch (err) {
      process.stderr.write(
        `  LLM extraction failed, falling back to regex: ${(err as Error).message}\n`
      );
    }
  }
  return extractWithRegex(transcript, callStatus);
}

// ─── LLM extraction ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert analyst for a restaurant mystery shopping service.
Analyze phone call transcripts and extract structured evaluation data.
Return a JSON object with exactly these fields:

rings_before_answer       integer or null   — count of "RING..." occurrences before pickup
had_professional_greeting boolean           — staff used a proper greeting ("thank you for calling", time-of-day, etc.)
restaurant_name_mentioned boolean           — staff said the restaurant name in their opening line
put_on_hold               boolean           — customer was placed on hold at any point
hold_duration_seconds     integer or null   — estimated hold time in seconds (null if unknown)
could_take_order          boolean           — staff was willing and able to accept a phone order
order_confirmed           boolean           — staff repeated the order back or confirmed total/ETA
upsell_attempted          boolean           — staff suggested extras, drinks, or add-ons
estimated_wait_time       string or null    — e.g. "15-20 minutes" (null if not stated)
staff_friendliness        "excellent"|"good"|"neutral"|"poor"
call_resolved             boolean           — call ended with a completed order or clear resolution
issues                    string[]          — specific friction points (e.g. "slow to answer (8 rings)", "excessive hold time (120s)", "refused phone orders", "rude staff")
notes                     string            — 1–2 sentence summary of the overall experience`;

async function extractWithLLM(
  client: OpenAI,
  transcript: string,
  callStatus: CallStatus
): Promise<Extraction> {
  if (callStatus !== 'answered') {
    return buildNonAnsweredExtraction(callStatus, transcript);
  }

  const response = await client.chat.completions.create({
    model: config.openai.model,
    response_format: { type: 'json_object' },
    temperature: 0,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Analyze this restaurant call transcript:\n\n${transcript}` },
    ],
  });

  const raw = JSON.parse(response.choices[0].message.content ?? '{}');

  const validFriendliness: StaffFriendliness[] = ['excellent', 'good', 'neutral', 'poor'];
  const friendliness: StaffFriendliness = validFriendliness.includes(raw.staff_friendliness)
    ? raw.staff_friendliness
    : 'neutral';

  return {
    was_answered: true,
    rings_before_answer: typeof raw.rings_before_answer === 'number' ? raw.rings_before_answer : null,
    had_professional_greeting: Boolean(raw.had_professional_greeting),
    restaurant_name_mentioned: Boolean(raw.restaurant_name_mentioned),
    put_on_hold: Boolean(raw.put_on_hold),
    hold_duration_seconds: typeof raw.hold_duration_seconds === 'number' ? raw.hold_duration_seconds : null,
    could_take_order: Boolean(raw.could_take_order),
    order_confirmed: Boolean(raw.order_confirmed),
    upsell_attempted: Boolean(raw.upsell_attempted),
    estimated_wait_time: raw.estimated_wait_time ?? null,
    staff_friendliness: friendliness,
    call_resolved: Boolean(raw.call_resolved),
    issues: Array.isArray(raw.issues) ? raw.issues.map(String) : [],
    notes: String(raw.notes ?? ''),
  };
}

// ─── Regex extraction (no API key required) ────────────────────────────────────

function extractWithRegex(transcript: string, callStatus: CallStatus): Extraction {
  if (callStatus !== 'answered') {
    return buildNonAnsweredExtraction(callStatus, transcript);
  }

  const t = transcript.toLowerCase();

  const rings = countRings(transcript);
  const hadProfessionalGreeting = detectProfessionalGreeting(t);
  const restaurantNameMentioned = detectRestaurantNameInGreeting(transcript);
  const holdInfo = detectHold(t);
  const couldTakeOrder = detectOrderCapability(t);
  const orderConfirmed = detectOrderConfirmed(t);
  const upsellAttempted = detectUpsell(t);
  const waitTime = extractWaitTime(t);
  const friendliness = scoreFriendliness(t);
  const callResolved = couldTakeOrder && orderConfirmed;
  const issues = collectIssues(t, holdInfo, rings, couldTakeOrder, friendliness, callResolved);

  return {
    was_answered: true,
    rings_before_answer: rings,
    had_professional_greeting: hadProfessionalGreeting,
    restaurant_name_mentioned: restaurantNameMentioned,
    put_on_hold: holdInfo.wasOnHold,
    hold_duration_seconds: holdInfo.durationSeconds,
    could_take_order: couldTakeOrder,
    order_confirmed: orderConfirmed,
    upsell_attempted: upsellAttempted,
    estimated_wait_time: waitTime,
    staff_friendliness: friendliness,
    call_resolved: callResolved,
    issues,
    notes: buildNotes(callStatus, rings, holdInfo, friendliness, couldTakeOrder),
  };
}

function buildNonAnsweredExtraction(
  callStatus: CallStatus,
  _transcript: string
): Extraction {
  const issueMap: Record<string, string> = {
    no_answer: 'no answer after multiple rings',
    voicemail: 'reached voicemail — call not answered by staff',
    busy: 'busy signal — line unavailable',
    failed: 'call failed — technical error',
  };

  return {
    was_answered: false,
    rings_before_answer: null,
    had_professional_greeting: false,
    restaurant_name_mentioned: false,
    put_on_hold: false,
    hold_duration_seconds: null,
    could_take_order: false,
    order_confirmed: false,
    upsell_attempted: false,
    estimated_wait_time: null,
    staff_friendliness: 'neutral',
    call_resolved: false,
    issues: [issueMap[callStatus] ?? 'unknown issue'],
    notes: `Call not completed: ${callStatus.replace('_', ' ')}`,
  };
}

function countRings(transcript: string): number {
  const matches = transcript.match(/RING\.\.\./g);
  return matches ? matches.length : 0;
}

function detectProfessionalGreeting(t: string): boolean {
  return (
    /thank you for calling/.test(t) ||
    /thanks for calling/.test(t) ||
    /good (morning|afternoon|evening)/.test(t) ||
    /how (can|may) i help/.test(t) ||
    /how can i assist/.test(t)
  );
}

function detectRestaurantNameInGreeting(transcript: string): boolean {
  const firstLine = transcript.split('\n').find(l => /^STAFF/.test(l)) ?? '';
  const words = firstLine.match(/[A-Z][a-z]+/g) ?? [];
  return words.length >= 2;
}

function detectHold(t: string): { wasOnHold: boolean; durationSeconds: number | null } {
  const onHold =
    /hold on/.test(t) ||
    /one (moment|second|minute)/.test(t) ||
    /\[hold/.test(t) ||
    /hold music/.test(t) ||
    /put you on hold/.test(t);

  if (!onHold) return { wasOnHold: false, durationSeconds: null };

  const durationMatch = t.match(
    /\[hold[^\]]*?(\d+)\s*(second|minute|min|sec)/
  );
  if (durationMatch) {
    const n = parseInt(durationMatch[1]);
    const unit = durationMatch[2];
    const seconds = unit.startsWith('min') ? n * 60 : n;
    return { wasOnHold: true, durationSeconds: seconds };
  }

  return { wasOnHold: true, durationSeconds: null };
}

function detectOrderCapability(t: string): boolean {
  const cantTake =
    /don'?t (do|take|accept) (that|order|phone|takeout)/.test(t) ||
    /can'?t take/.test(t) ||
    /use (the )?website/.test(t) ||
    /use (the )?app/.test(t) ||
    /come in/.test(t) ||
    /call back later/.test(t) ||
    /not taking (phone|takeout|orders)/.test(t);

  if (cantTake) return false;

  const canTake =
    /what (can i|would you like|can i get)/.test(t) ||
    /go ahead/.test(t) ||
    /name for the order/.test(t) ||
    /name\?/.test(t) ||
    /\bname\b/.test(t) ||
    /total (is|will be)/.test(t) ||
    /\$\d/.test(t) ||
    /ready in/.test(t) ||
    /minutes/.test(t);

  return canTake;
}

function detectOrderConfirmed(t: string): boolean {
  return (
    /that'?s (the|your) order/.test(t) ||
    /so that'?s/.test(t) ||
    /your total (is|will be)/.test(t) ||
    /ready in/.test(t) ||
    /see you (soon|then|in)/.test(t) ||
    /\$\d/.test(t)
  );
}

function detectUpsell(t: string): boolean {
  return (
    /anything else/.test(t) ||
    /would you like/.test(t) ||
    /maybe a (drink|dessert|side|appetizer)/.test(t) ||
    /can i add/.test(t) ||
    /daily special/.test(t) ||
    /try our/.test(t)
  );
}

function extractWaitTime(t: string): string | null {
  const match = t.match(/(\d+)[\s-]*(?:to[\s-]*(\d+))?\s*minutes?/);
  if (!match) return null;
  return match[2] ? `${match[1]}-${match[2]} minutes` : `${match[1]} minutes`;
}

function scoreFriendliness(t: string): StaffFriendliness {
  const excellent = [
    /you'?re welcome/,
    /great choice/,
    /perfect/,
    /absolutely/,
    /of course/,
    /drive safe/,
    /see you soon/,
  ];
  const poor = [
    /yeah\?/,
    /what do you want/,
    /\byeah okay\b/,
    /we'?re super busy/,
    /just use the (website|app)/,
    /\[call ends\]/,
    /anything else\?\s*(no|nope)/,
  ];

  const excellentHits = excellent.filter(r => r.test(t)).length;
  const poorHits = poor.filter(r => r.test(t)).length;

  if (poorHits >= 2) return 'poor';
  if (poorHits === 1 && excellentHits === 0) return 'neutral';
  if (excellentHits >= 3) return 'excellent';
  if (excellentHits >= 1) return 'good';
  return 'neutral';
}

function collectIssues(
  t: string,
  holdInfo: { wasOnHold: boolean; durationSeconds: number | null },
  rings: number,
  couldTakeOrder: boolean,
  friendliness: StaffFriendliness,
  callResolved: boolean
): string[] {
  const issues: string[] = [];

  if (rings >= 6) issues.push(`slow to answer (${rings} rings)`);
  if (holdInfo.wasOnHold) {
    const dur = holdInfo.durationSeconds;
    issues.push(dur ? `put on hold (${dur}s)` : 'put on hold');
    if (dur && dur > 90) issues.push('excessive hold time (>90s)');
  }
  if (!couldTakeOrder) issues.push('could not / would not take phone order');
  if (friendliness === 'poor') issues.push('rude or dismissive staff');
  if (!callResolved) issues.push('call not resolved');
  if (/use (the )?(website|app)/.test(t)) issues.push('redirected to website/app');

  return issues;
}

function buildNotes(
  _callStatus: CallStatus,
  rings: number,
  holdInfo: { wasOnHold: boolean; durationSeconds: number | null },
  friendliness: StaffFriendliness,
  couldTakeOrder: boolean
): string {
  const parts: string[] = [];
  if (rings > 0) parts.push(`Answered after ${rings} rings`);
  if (holdInfo.wasOnHold) {
    parts.push(
      holdInfo.durationSeconds
        ? `Hold time: ${holdInfo.durationSeconds}s`
        : 'Staff put customer on hold'
    );
  }
  if (!couldTakeOrder) parts.push('Staff refused to take order over phone');
  parts.push(`Staff friendliness: ${friendliness}`);
  return parts.join('. ');
}
