import test from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import {
  getNextBusinessWindowMs,
  isWithinBusinessHours,
} from '../src/scheduling/scheduler';

const originalNow = DateTime.now;

function setNow(iso: string, zone: string): void {
  (DateTime as any).now = () => DateTime.fromISO(iso, { zone });
}

function restoreNow(): void {
  (DateTime as any).now = originalNow;
}

test('isWithinBusinessHours returns true during the configured window in a timezone', () => {
  setNow('2024-03-14T15:00:00', 'America/New_York');
  try {
    assert.equal(isWithinBusinessHours('America/New_York'), true);
  } finally {
    restoreNow();
  }
});

test('isWithinBusinessHours returns false before opening time', () => {
  setNow('2024-03-14T09:30:00', 'America/New_York');
  try {
    assert.equal(isWithinBusinessHours('America/New_York'), false);
  } finally {
    restoreNow();
  }
});

test('isWithinBusinessHours returns false after closing time', () => {
  setNow('2024-03-14T22:30:00', 'America/New_York');
  try {
    assert.equal(isWithinBusinessHours('America/New_York'), false);
  } finally {
    restoreNow();
  }
});

test('getNextBusinessWindowMs returns time until next business opening when it is after hours', () => {
  setNow('2024-03-14T22:00:00', 'America/New_York');
  try {
    const nextWindow = getNextBusinessWindowMs('America/New_York');
    assert.ok(nextWindow > 0);
    assert.ok(nextWindow < 24 * 60 * 60 * 1000);
  } finally {
    restoreNow();
  }
});
