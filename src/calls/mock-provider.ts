import type { MockCallResult, CallStatus } from '../types';

// Weighted scenario table — weights must sum to 100
const SCENARIOS: Array<{
  type: CallStatus | 'answered_excellent' | 'answered_good' | 'answered_average' | 'answered_poor';
  weight: number;
  rings: number;
  durationRange: [number, number];
}> = [
  { type: 'answered_excellent', weight: 25, rings: 2, durationRange: [60, 120] },
  { type: 'answered_good',      weight: 30, rings: 3, durationRange: [75, 150] },
  { type: 'answered_average',   weight: 15, rings: 4, durationRange: [90, 180] },
  { type: 'answered_poor',      weight: 10, rings: 6, durationRange: [20, 45]  },
  { type: 'no_answer',          weight: 12, rings: 8, durationRange: [30, 30]  },
  { type: 'voicemail',          weight: 5,  rings: 4, durationRange: [20, 25]  },
  { type: 'busy',               weight: 3,  rings: 0, durationRange: [3, 5]    },
];

function pickScenario(seed: number) {
  let cumulative = 0;
  const roll = seed % 100;
  for (const s of SCENARIOS) {
    cumulative += s.weight;
    if (roll < cumulative) return s;
  }
  return SCENARIOS[0];
}

// djb2 hash of phone digits — gives well-distributed values 0–99
// so the 7 scenarios appear in realistic proportions across a lead list
function phoneSeed(phone: string): number {
  const digits = phone.replace(/\D/g, '');
  let hash = 5381;
  for (const char of digits) {
    hash = (Math.imul(hash, 33) ^ char.charCodeAt(0)) >>> 0;
  }
  return hash % 100;
}

function randInRange(min: number, max: number, seed: number): number {
  return Math.floor(min + ((seed * 9301 + 49297) % 233280) / 233280 * (max - min + 1));
}

function ringStr(n: number): string {
  return Array.from({ length: n }, () => 'RING...').join(' ');
}

function buildTranscript(
  type: string,
  restaurantName: string,
  rings: number,
  phone: string
): string {
  const seed = phoneSeed(phone);
  const staffNames = ['Sofia', 'Marcus', 'Priya', 'Jake', 'Nadia', 'Carlos'];
  const staff = staffNames[seed % staffNames.length];
  const items = [
    ['a chicken sandwich and fries', '$16.50', '15-20 minutes'],
    ['the shrimp tacos and a side salad', '$18.25', '20 minutes'],
    ['two burgers and onion rings', '$22.00', '18-22 minutes'],
    ['the pasta special and garlic bread', '$19.75', '25 minutes'],
    ['a large pizza — half pepperoni, half veggie', '$24.50', '25-30 minutes'],
  ];
  const [item, total, eta] = items[seed % items.length];

  switch (type) {
    case 'answered_excellent':
      return [
        ringStr(rings),
        `STAFF (${staff}): "Good afternoon, thank you for calling ${restaurantName}! This is ${staff}, how can I help you?"`,
        `CUSTOMER: "Hi! I'd like to place a takeout order, please."`,
        `STAFF (${staff}): "Absolutely! What can I get started for you today?"`,
        `CUSTOMER: "Can I get ${item}?"`,
        `STAFF (${staff}): "Perfect choice! Anything else — maybe a drink or dessert to go with that?"`,
        `CUSTOMER: "No thanks, that's all."`,
        `STAFF (${staff}): "Got it! Can I get a name for the order?"`,
        `CUSTOMER: "Alex."`,
        `STAFF (${staff}): "Great, Alex! So that's ${item}. Your total is ${total} and it'll be ready in about ${eta}. We'll see you soon!"`,
        `CUSTOMER: "Awesome, thank you!"`,
        `STAFF (${staff}): "You're welcome! Drive safe!"`,
      ].join('\n');

    case 'answered_good':
      return [
        ringStr(rings),
        `STAFF: "${restaurantName}, how can I help?"`,
        `CUSTOMER: "Hi, I wanted to place a takeout order."`,
        `STAFF: "Sure, hold on one second."`,
        `[HOLD — approx. 30 seconds]`,
        `STAFF: "Okay, what would you like?"`,
        `CUSTOMER: "Can I get ${item}?"`,
        `STAFF: "Yep. Name for the order?"`,
        `CUSTOMER: "Alex."`,
        `STAFF: "Okay Alex, that'll be ready in ${eta}. Total is ${total}."`,
        `CUSTOMER: "Great, thanks."`,
        `STAFF: "Mm-hm, bye."`,
      ].join('\n');

    case 'answered_average':
      return [
        ringStr(rings),
        `STAFF: "Hello?"`,
        `CUSTOMER: "Hi, I'd like to place a takeout order."`,
        `STAFF: "Hold on."`,
        `[HOLD MUSIC — approx. 2 minutes]`,
        `STAFF: "Yeah, what do you want?"`,
        `CUSTOMER: "Can I get ${item}?"`,
        `STAFF: "Uh... I think we have that. Name?"`,
        `CUSTOMER: "Alex."`,
        `STAFF: "Okay. Maybe like 30 minutes? I'm not sure of the price, just pay when you get here."`,
        `CUSTOMER: "Okay... thanks."`,
      ].join('\n');

    case 'answered_poor':
      return [
        ringStr(rings),
        `STAFF: "Yeah?"`,
        `CUSTOMER: "Hi, I'd like to place a takeout order please."`,
        `STAFF: "We're super busy right now. Can you use the website or just come in?"`,
        `CUSTOMER: "Oh, I was hoping to order over the phone—"`,
        `STAFF: "Yeah we don't really do that. Website is easier. Anything else?"`,
        `CUSTOMER: "No, that's—"`,
        `[CALL ENDS]`,
      ].join('\n');

    case 'no_answer':
      return [
        ringStr(rings),
        `[NO ANSWER — call disconnected after ${rings} rings]`,
      ].join('\n');

    case 'voicemail':
      return [
        ringStr(rings),
        `AUTOMATED: "You've reached ${restaurantName}. Our hours are Tuesday through Sunday, 11 AM to 9 PM. Please leave a message after the beep and we'll get back to you. Thank you!"`,
        `[BEEP]`,
        `[CUSTOMER HANGS UP — did not leave voicemail]`,
      ].join('\n');

    case 'busy':
      return `[BUSY SIGNAL — line unavailable]`;

    default:
      return '[UNKNOWN SCENARIO]';
  }
}

function scenarioToCallStatus(type: string): CallStatus {
  if (type.startsWith('answered')) return 'answered';
  return type as CallStatus;
}

export async function placeCall(
  phone: string,
  restaurantName: string,
  delayMs: number
): Promise<MockCallResult> {
  const seed = phoneSeed(phone);
  const scenario = pickScenario(seed);
  const duration = randInRange(...scenario.durationRange, seed);

  // Simulate call duration
  await new Promise(resolve => setTimeout(resolve, Math.min(delayMs, 3000)));

  const callStatus = scenarioToCallStatus(scenario.type);
  const transcript = buildTranscript(scenario.type, restaurantName, scenario.rings, phone);

  return {
    status: callStatus,
    duration_seconds: duration,
    transcript,
    rings: scenario.rings,
  };
}

export const PROVIDER_NAME = 'mock';
