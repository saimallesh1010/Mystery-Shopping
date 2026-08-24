import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

function readInteger(name: string, fallback: number, minimum: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isInteger(value) && value >= minimum ? value : fallback;
}

const businessHoursStart = readInteger('BUSINESS_HOURS_START', 11, 0);
const businessHoursEnd = readInteger('BUSINESS_HOURS_END', 21, 1);

export const config = {
  database: {
    path: process.env.DB_PATH
      ? path.resolve(process.env.DB_PATH)
      : path.join(process.cwd(), 'data', 'mystery-shopper.db'),
  },
  calls: {
    provider: (process.env.CALL_PROVIDER ?? 'mock') as 'mock' | 'twilio',
    mockDelayMs: readInteger('MOCK_CALL_DELAY_MS', 1500, 0),
    maxRetries: readInteger('MAX_RETRIES', 2, 0),
    retryDelayHours: readInteger('RETRY_DELAY_HOURS', 2, 0),
    concurrency: readInteger('CALL_CONCURRENCY', 3, 1),
  },
  scheduling: {
    businessHoursStart: Math.min(businessHoursStart, 23),
    businessHoursEnd: Math.min(businessHoursEnd, 24),
    minCallGapMs: readInteger('MIN_CALL_GAP_MS', 5000, 0),
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
    authToken: process.env.TWILIO_AUTH_TOKEN ?? '',
    phoneNumber: process.env.TWILIO_PHONE_NUMBER ?? '',
  },
  leads: {
    csvPath: process.env.LEADS_CSV_PATH
      ? path.resolve(process.env.LEADS_CSV_PATH)
      : path.join(process.cwd(), 'data', 'leads.csv'),
  },
};

export const STATE_TIMEZONES: Record<string, string> = {
  // Eastern
  CT: 'America/New_York', DE: 'America/New_York', FL: 'America/New_York',
  GA: 'America/New_York', ME: 'America/New_York', MD: 'America/New_York',
  MA: 'America/New_York', NH: 'America/New_York', NJ: 'America/New_York',
  NY: 'America/New_York', NC: 'America/New_York', OH: 'America/New_York',
  PA: 'America/New_York', RI: 'America/New_York', SC: 'America/New_York',
  VT: 'America/New_York', VA: 'America/New_York', WV: 'America/New_York',
  DC: 'America/New_York', IN: 'America/Indiana/Indianapolis',
  KY: 'America/Kentucky/Louisville', MI: 'America/Detroit',
  // Central
  AL: 'America/Chicago', AR: 'America/Chicago', IA: 'America/Chicago',
  IL: 'America/Chicago', KS: 'America/Chicago', LA: 'America/Chicago',
  MN: 'America/Chicago', MS: 'America/Chicago', MO: 'America/Chicago',
  NE: 'America/Chicago', ND: 'America/Chicago', OK: 'America/Chicago',
  SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago',
  WI: 'America/Chicago',
  // Mountain
  CO: 'America/Denver', ID: 'America/Boise', MT: 'America/Denver',
  NM: 'America/Denver', UT: 'America/Denver', WY: 'America/Denver',
  AZ: 'America/Phoenix',
  // Pacific
  CA: 'America/Los_Angeles', NV: 'America/Los_Angeles',
  OR: 'America/Los_Angeles', WA: 'America/Los_Angeles',
  // Non-contiguous
  AK: 'America/Anchorage', HI: 'Pacific/Honolulu',
};
