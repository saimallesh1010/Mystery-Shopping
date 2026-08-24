import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFromTranscript } from '../src/extraction/extractor';
import { normalizePhone } from '../src/ingestion/csv-importer';

test('normalizePhone returns ten digits from common US formats', () => {
  assert.equal(normalizePhone('(415) 555-0132'), '4155550132');
  assert.equal(normalizePhone('+1 415-555-0132'), '4155550132');
});

test('normalizePhone rejects invalid phone numbers', () => {
  assert.equal(normalizePhone('555-0132'), '');
  assert.equal(normalizePhone('41555501321'), '');
});

test('extractFromTranscript identifies a completed order from an answered call', async () => {
  const extraction = await extractFromTranscript(
    [
      'RING... RING...',
      'STAFF: "Good afternoon, thank you for calling Summit Bistro! How can I help you?"',
      'CUSTOMER: "I would like a takeout order."',
      'STAFF: "Absolutely. What can I get for you?"',
      'CUSTOMER: "A burger, please."',
      'STAFF: "Anything else? Your total is $12 and it will be ready in 20 minutes."',
    ].join('\n'),
    'answered'
  );

  assert.equal(extraction.was_answered, true);
  assert.equal(extraction.rings_before_answer, 2);
  assert.equal(extraction.had_professional_greeting, true);
  assert.equal(extraction.restaurant_name_mentioned, true);
  assert.equal(extraction.could_take_order, true);
  assert.equal(extraction.order_confirmed, true);
  assert.equal(extraction.estimated_wait_time, '20 minutes');
});

test('extractFromTranscript returns fixed fields for a missed call', async () => {
  const extraction = await extractFromTranscript('[NO ANSWER]', 'no_answer');

  assert.equal(extraction.was_answered, false);
  assert.equal(extraction.call_resolved, false);
  assert.deepEqual(extraction.issues, ['no answer after multiple rings']);
  assert.equal(extraction.staff_friendliness, 'neutral');
});
