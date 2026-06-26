import { createCallAttempt, saveCallResult } from '../db/repository';
import { placeCall, PROVIDER_NAME } from './mock-provider';
import { extractFromTranscript } from '../extraction/extractor';
import { scoreCall } from '../scoring/scorer';
import {
  markLeadCalling,
  markLeadCompleted,
  markLeadForRetry,
} from '../scheduling/scheduler';
import { getDb } from '../db/schema';
import { config } from '../config/settings';
import type { ScheduledLead, CallProvider } from '../types';

// Swap this import for a real provider (Vapi, Bland.ai, Twilio) — interface is CallProvider
const callProvider: CallProvider = placeCall;

export interface OrchestratorResult {
  leadId: string;
  restaurantName: string;
  phone: string;
  callStatus: string;
  sdrSignal: string;
  sdrNotes: string;
  overallScore: number;
  error?: string;
}

export async function runCall(scheduled: ScheduledLead): Promise<OrchestratorResult> {
  const { lead, attempt_number } = scheduled;

  markLeadCalling(lead);

  const startedAt = new Date().toISOString();

  try {
    const mockResult = await callProvider(
      lead.phone,
      lead.restaurant_name,
      config.calls.mockDelayMs
    );

    const endedAt = new Date().toISOString();

    const attempt = createCallAttempt({
      lead_id: lead.id,
      attempt_number,
      scheduled_at: startedAt,
      started_at: startedAt,
      ended_at: endedAt,
      duration_seconds: mockResult.duration_seconds,
      status: mockResult.status,
      provider: PROVIDER_NAME,
      transcript: mockResult.transcript,
      raw_provider_data: null,
    });

    const extraction = await extractFromTranscript(mockResult.transcript, mockResult.status);
    // Inject ring count from the mock (overrides LLM/regex count with ground truth)
    extraction.rings_before_answer =
      mockResult.status === 'answered' ? mockResult.rings : null;

    const { scores, sdrSignal, sdrNotes } = scoreCall(extraction, mockResult.status);

    // Atomically persist result + update lead status so they are always in sync
    const db = getDb();
    db.exec('BEGIN');
    try {
      saveCallResult(attempt.id, lead.id, extraction, scores, sdrSignal, sdrNotes);
      if (mockResult.status === 'no_answer' || mockResult.status === 'busy') {
        markLeadForRetry(lead);
      } else {
        markLeadCompleted(lead);
      }
      db.exec('COMMIT');
    } catch (txErr) {
      db.exec('ROLLBACK');
      throw txErr;
    }

    return {
      leadId: lead.id,
      restaurantName: lead.restaurant_name,
      phone: lead.phone,
      callStatus: mockResult.status,
      sdrSignal,
      sdrNotes,
      overallScore: Math.round(scores.overall),
    };
  } catch (err) {
    markLeadForRetry(lead);
    return {
      leadId: lead.id,
      restaurantName: lead.restaurant_name,
      phone: lead.phone,
      callStatus: 'failed',
      sdrSignal: 'hot',
      sdrNotes: 'Call failed — technical error',
      overallScore: 0,
      error: (err as Error).message,
    };
  }
}

export async function runBatch(scheduledLeads: ScheduledLead[]): Promise<OrchestratorResult[]> {
  const results: OrchestratorResult[] = [];
  const { concurrency } = config.calls;

  for (let i = 0; i < scheduledLeads.length; i += concurrency) {
    const batch = scheduledLeads.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(s => runCall(s)));
    results.push(...batchResults);

    // Brief gap between batches
    if (i + concurrency < scheduledLeads.length) {
      await new Promise(r => setTimeout(r, config.scheduling.minCallGapMs));
    }
  }

  return results;
}
