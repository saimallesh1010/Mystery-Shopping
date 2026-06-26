import { DateTime } from 'luxon';
import {
  getLeadsByStatus,
  getLeadsForRetry,
  updateLeadStatus,
} from '../db/repository';
import { config } from '../config/settings';
import type { Lead, ScheduledLead } from '../types';

export function isWithinBusinessHours(timezone: string): boolean {
  const now = DateTime.now().setZone(timezone);
  if (!now.isValid) return false;
  const hour = now.hour;
  return hour >= config.scheduling.businessHoursStart &&
         hour < config.scheduling.businessHoursEnd;
}

export function getNextBusinessWindowMs(timezone: string): number {
  const now = DateTime.now().setZone(timezone);
  if (!now.isValid) return 0;
  const openToday = now.set({ hour: config.scheduling.businessHoursStart, minute: 0, second: 0 });
  const openTomorrow = openToday.plus({ days: 1 });

  if (now < openToday) {
    return openToday.diff(now).milliseconds;
  }
  return openTomorrow.diff(now).milliseconds;
}

export function getEligibleLeads(): ScheduledLead[] {
  const pending = getLeadsByStatus('pending');
  const retries = getLeadsForRetry(config.calls.retryDelayHours);

  const candidates: ScheduledLead[] = [
    ...pending.map(l => ({ lead: l, attempt_number: 1 })),
    ...retries.map(l => ({ lead: l, attempt_number: l.attempt_count + 1 })),
  ];

  const eligible: ScheduledLead[] = [];
  const seenPhones = new Set<string>();

  for (const candidate of candidates) {
    const { lead, attempt_number } = candidate;

    // Skip if already calling
    if (lead.status === 'calling') continue;

    // Skip if max retries exceeded
    if (attempt_number > config.calls.maxRetries + 1) {
      updateLeadStatus(lead.id, 'failed');
      continue;
    }

    // Skip if not within business hours
    if (!isWithinBusinessHours(lead.timezone)) continue;

    // Don't call same number twice in a row in the same batch
    if (seenPhones.has(lead.phone)) continue;
    seenPhones.add(lead.phone);

    eligible.push(candidate);
  }

  return eligible;
}

export function markLeadCalling(lead: Lead): void {
  updateLeadStatus(lead.id, 'calling');
}

export function markLeadCompleted(lead: Lead): void {
  updateLeadStatus(lead.id, 'completed', {
    attempt_count: lead.attempt_count + 1,
    last_attempted_at: new Date().toISOString(),
  });
}

export function markLeadForRetry(lead: Lead): void {
  const newCount = lead.attempt_count + 1;
  if (newCount > config.calls.maxRetries) {
    updateLeadStatus(lead.id, 'failed', {
      attempt_count: newCount,
      last_attempted_at: new Date().toISOString(),
    });
  } else {
    updateLeadStatus(lead.id, 'retry', {
      attempt_count: newCount,
      last_attempted_at: new Date().toISOString(),
    });
  }
}

export function markLeadFailed(lead: Lead): void {
  updateLeadStatus(lead.id, 'failed', {
    attempt_count: lead.attempt_count + 1,
    last_attempted_at: new Date().toISOString(),
  });
}
