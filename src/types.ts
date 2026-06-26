export type LeadStatus =
  | 'pending'
  | 'scheduled'
  | 'calling'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'retry';

export type CallStatus =
  | 'answered'
  | 'no_answer'
  | 'voicemail'
  | 'busy'
  | 'failed';

export type StaffFriendliness = 'excellent' | 'good' | 'neutral' | 'poor';

export type SdrSignal = 'hot' | 'warm' | 'cold';

export interface Lead {
  id: string;
  first_name: string;
  last_name: string;
  restaurant_name: string;
  phone: string;
  email: string;
  website: string;
  street_address: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  timezone: string;
  google_reviews_count: number;
  google_maps_url: string;
  status: LeadStatus;
  attempt_count: number;
  last_attempted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CallAttempt {
  id: string;
  lead_id: string;
  attempt_number: number;
  scheduled_at: string | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  status: CallStatus;
  provider: string;
  transcript: string | null;
  raw_provider_data: string | null;
  created_at: string;
}

export interface Extraction {
  was_answered: boolean;
  rings_before_answer: number | null;
  had_professional_greeting: boolean;
  restaurant_name_mentioned: boolean;
  put_on_hold: boolean;
  hold_duration_seconds: number | null;
  could_take_order: boolean;
  order_confirmed: boolean;
  upsell_attempted: boolean;
  estimated_wait_time: string | null;
  staff_friendliness: StaffFriendliness;
  call_resolved: boolean;
  issues: string[];
  notes: string;
}

export interface Scores {
  pickup: number;           // 0–10
  greeting: number;         // 0–10
  responsiveness: number;   // 0–10
  order_capability: number; // 0–10
  accuracy: number;         // 0–10
  friendliness: number;     // 0–10
  overall: number;          // 0–100 weighted composite
}

export interface CallResult {
  id: string;
  call_attempt_id: string;
  lead_id: string;
  extraction: Extraction;
  scores: Scores;
  sdr_signal: SdrSignal;
  sdr_notes: string;
  extracted_at: string;
}

export interface MockCallResult {
  status: CallStatus;
  duration_seconds: number;
  transcript: string;
  rings: number;
}

/**
 * Contract every call provider must implement.
 * Swap mock-provider.ts for a real implementation (Vapi, Bland.ai, Twilio)
 * by exporting a function with this exact signature — nothing else changes.
 *
 * @param phone            10-digit US phone number (digits only)
 * @param restaurantName   Used to personalize the agent greeting check
 * @param delayMs          Optional artificial delay (ignored by real providers)
 */
export type CallProvider = (
  phone: string,
  restaurantName: string,
  delayMs: number
) => Promise<MockCallResult>;

export interface ScheduledLead {
  lead: Lead;
  attempt_number: number;
}
