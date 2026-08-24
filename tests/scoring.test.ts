import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreCall } from '../src/scoring/scorer';

const answered = {
  was_answered: true,
  rings_before_answer: 2,
  had_professional_greeting: true,
  restaurant_name_mentioned: true,
  put_on_hold: false,
  hold_duration_seconds: null,
  could_take_order: true,
  order_confirmed: true,
  upsell_attempted: false,
  estimated_wait_time: '15 minutes',
  staff_friendliness: 'excellent' as const,
  call_resolved: true,
  issues: [],
  notes: 'Friendly call handled well.',
};

test('scoreCall returns a strong score and cold signal for a good answered call', () => {
  const result = scoreCall(answered, 'answered');

  assert.equal(result.sdrSignal, 'cold');
  assert.ok(result.scores.overall >= 70);
  assert.ok(result.scores.pickup >= 8);
  assert.ok(result.scores.greeting >= 8);
});

test('scoreCall marks unanswered calls as hot', () => {
  const result = scoreCall({ ...answered, was_answered: false }, 'no_answer');

  assert.equal(result.sdrSignal, 'hot');
  assert.equal(result.scores.overall, 0);
});

test('scoreCall marks poor answered calls as hot', () => {
  const poor = {
    ...answered,
    had_professional_greeting: false,
    restaurant_name_mentioned: false,
    put_on_hold: true,
    hold_duration_seconds: 240,
    could_take_order: false,
    order_confirmed: false,
    estimated_wait_time: null,
    staff_friendliness: 'poor' as const,
    issues: ['Long hold', 'No order capability'],
  };

  const result = scoreCall(poor, 'answered');

  assert.equal(result.sdrSignal, 'hot');
  assert.ok(result.scores.overall < 40);
});
