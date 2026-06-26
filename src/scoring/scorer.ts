import type { Extraction, Scores, SdrSignal, CallStatus, StaffFriendliness } from '../types';

/**
 * Scoring rubric (each dimension 0–10, overall 0–100):
 *
 * Dimension        Weight  What it measures
 * ─────────────── ─────── ─────────────────────────────────────────────
 * pickup            20%   Answered? How quickly?
 * greeting          15%   Professional greeting with restaurant name?
 * responsiveness    25%   Hold time, speed of service
 * order_capability  25%   Could/did they take the order?
 * accuracy          10%   Was order confirmed correctly?
 * friendliness       5%   Staff warmth and engagement
 *
 * SDR signal (for Maple sales team):
 *   hot  → overall < 40  (terrible experience, strong Maple candidate)
 *   warm → overall 40–69 (some issues, worth outreach)
 *   cold → overall ≥ 70  (solid phone experience, lower priority)
 *
 * Special case: no_answer / voicemail / busy → auto hot
 * (missing calls = direct revenue loss = best Maple pitch)
 */

export function scoreCall(
  extraction: Extraction,
  callStatus: CallStatus
): { scores: Scores; sdrSignal: SdrSignal; sdrNotes: string } {
  const scores = computeScores(extraction, callStatus);
  const { sdrSignal, sdrNotes } = computeSdrSignal(scores, extraction, callStatus);
  return { scores, sdrSignal, sdrNotes };
}

function computeScores(extraction: Extraction, callStatus: CallStatus): Scores {
  const pickup = scorePickup(extraction, callStatus);
  const greeting = scoreGreeting(extraction);
  const responsiveness = scoreResponsiveness(extraction);
  const order_capability = scoreOrderCapability(extraction);
  const accuracy = scoreAccuracy(extraction);
  const friendliness = scoreFriendliness(extraction.staff_friendliness);

  // Weighted composite: weights sum to 1.0, each score is 0–10 → overall 0–100
  const overall = Math.round(
    pickup        * 2.0 +
    greeting      * 1.5 +
    responsiveness * 2.5 +
    order_capability * 2.5 +
    accuracy       * 1.0 +
    friendliness   * 0.5
  );

  return { pickup, greeting, responsiveness, order_capability, accuracy, friendliness, overall };
}

function scorePickup(extraction: Extraction, callStatus: CallStatus): number {
  if (!extraction.was_answered) return 0;
  const rings = extraction.rings_before_answer ?? 3;
  if (rings <= 2) return 10;
  if (rings <= 3) return 8;
  if (rings <= 5) return 6;
  if (rings <= 7) return 4;
  return 2;
}

function scoreGreeting(extraction: Extraction): number {
  if (!extraction.was_answered) return 0;
  let score = 4; // base for answering
  if (extraction.had_professional_greeting) score += 4;
  if (extraction.restaurant_name_mentioned) score += 2;
  return Math.min(score, 10);
}

function scoreResponsiveness(extraction: Extraction): number {
  if (!extraction.was_answered) return 0;
  if (!extraction.put_on_hold) return 10;

  const hold = extraction.hold_duration_seconds ?? 60;
  if (hold <= 20) return 8;
  if (hold <= 45) return 6;
  if (hold <= 90) return 4;
  if (hold <= 180) return 2;
  return 0;
}

function scoreOrderCapability(extraction: Extraction): number {
  if (!extraction.was_answered) return 0;
  if (!extraction.could_take_order) return 0;
  if (extraction.order_confirmed) return 10;
  return 6; // took order but didn't confirm explicitly
}

function scoreAccuracy(extraction: Extraction): number {
  if (!extraction.was_answered || !extraction.could_take_order) return 0;
  if (extraction.order_confirmed) return 10;
  if (extraction.estimated_wait_time) return 5; // partial confirmation
  return 2;
}

function scoreFriendliness(friendliness: StaffFriendliness): number {
  const map: Record<StaffFriendliness, number> = {
    excellent: 10,
    good: 7,
    neutral: 5,
    poor: 1,
  };
  return map[friendliness];
}

function computeSdrSignal(
  scores: Scores,
  extraction: Extraction,
  callStatus: CallStatus
): { sdrSignal: SdrSignal; sdrNotes: string } {
  // Unanswered calls = hottest leads (Maple directly solves missed calls)
  if (callStatus === 'no_answer') {
    return {
      sdrSignal: 'hot',
      sdrNotes: 'Never answered — missing calls means lost revenue. Maple can capture every lead.',
    };
  }
  if (callStatus === 'voicemail') {
    return {
      sdrSignal: 'hot',
      sdrNotes: 'Reached voicemail — callers expecting a person hang up. Maple answers every call.',
    };
  }
  if (callStatus === 'busy') {
    return {
      sdrSignal: 'hot',
      sdrNotes: 'Busy signal detected — single line is a bottleneck. Maple handles concurrent calls.',
    };
  }

  // Answered calls — score-based
  const issues = extraction.issues.join('; ');

  if (scores.overall < 40) {
    const pain = !extraction.could_take_order
      ? 'Staff refused phone orders — Maple ensures every call converts.'
      : extraction.staff_friendliness === 'poor'
      ? 'Rude or dismissive staff — Maple delivers consistent, branded experience.'
      : `Poor overall experience (${scores.overall}/100). Maple addresses: ${issues || 'multiple friction points'}.`;
    return { sdrSignal: 'hot', sdrNotes: pain };
  }

  if (scores.overall < 70) {
    const note =
      issues
        ? `Room to improve: ${issues}. Maple could streamline order taking.`
        : `Average experience (${scores.overall}/100) — Maple could improve speed and consistency.`;
    return { sdrSignal: 'warm', sdrNotes: note };
  }

  return {
    sdrSignal: 'cold',
    sdrNotes: `Strong phone experience (${scores.overall}/100) — lower priority for Maple outreach.`,
  };
}
