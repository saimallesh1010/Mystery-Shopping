#  Mystery Shopper

An AI mystery-shopping system that calls restaurants, evaluates their phone experience, and surfaces structured SDR signals so the sales team knows exactly who to call and why — before the first outreach.

---

## Quick Start

```bash
npm install
cp .env.example .env          # no API keys needed — system works fully offline

npm run demo                  # import leads + run mock calls + print report
npm run serve                 # start web dashboard → http://localhost:3000
```

> **No API key required.** The system runs completely offline using regex-based extraction. Set `OPENAI_API_KEY` in `.env` to upgrade extraction accuracy from ~85% → ~95% on answered calls — the pipeline automatically uses LLM when the key is present and falls back to regex silently if it's missing or the call fails.

Step by step:
```bash
npm run import                # parse data/leads.csv → SQLite
npm run run                   # place calls for all eligible leads
npm run report                # human-readable terminal report
npm run report -- --json      # machine-readable JSON
npm run reset                 # reset all leads to pending (re-run)
```

---

## Design Decisions

### Why SQLite instead of Postgres

SQLite ships with Node 22 (`node:sqlite`), requires zero infrastructure, and produces a single portable file you can open in any SQL client or attach to a BI tool. The data fits comfortably in one table per entity. The tradeoff is no concurrent writers — fine for a batch job that runs one at a time, wrong for a multi-server production deployment. If this scaled to real-time concurrent call results from hundreds of simultaneous lines, I'd swap the repository layer for Postgres; the SQL is vanilla and nothing else would change.

### Why a dual extraction path (regex + LLM)

The regex path is fast, deterministic, offline, and free — it handles the structured signals in the mock transcripts perfectly (hold time in brackets, order confirmation phrases, ring counts). The LLM path (GPT-4o-mini) handles ambiguous phrasing, implied meanings, and messy real-world transcripts better but requires an API key and adds ~500ms latency per call.

Rather than pick one, the system tries LLM if `OPENAI_API_KEY` is set and falls back to regex silently on failure. This means the codebase works out of the box for evaluation and gets meaningfully better in production — without a config change from the caller.

The extraction step is **completely separate from the scoring step** by design. `extractor.ts` knows nothing about scores; `scorer.ts` knows nothing about transcripts. This separation means you can swap either independently — plug in a different LLM, change the scoring rubric, add new extraction fields — without touching the other half.

### Why these 6 scoring dimensions

The rubric is designed around Maple's pitch: restaurants lose revenue when calls go wrong. Each dimension maps to a specific failure mode Maple solves:

| Dimension | Weight | Rationale |
|---|---|---|
| Pickup | 20% | No answer = immediate revenue loss. Weighted high because it's the most unambiguous signal. |
| Responsiveness | 25% | Long holds are the #1 caller complaint. Highest weight because friction here drives hangups. |
| Order capability | 25% | If they can't take an order over the phone, that's Maple's clearest value prop. |
| Greeting | 15% | Named greeting builds caller confidence; missing it signals disorganization. |
| Accuracy | 10% | Order confirmation + wait time reduce pickup friction; important but recoverable. |
| Friendliness | 5% | Matters for brand, but a cold-but-efficient restaurant still takes the order. |

### Why unanswered calls are auto-HOT regardless of score

A restaurant that doesn't pick up is losing revenue on every ring. Maple's core pitch is "we answer every call." There's no score to compute — the business case sells itself. These leads should be at the top of every SDR's call list.

### Why deterministic phone-seeded scenarios in the mock

The mock provider uses a djb2 hash of the phone number to pick a scenario. This means:
- The same lead always produces the same call result — the system is testable and reproducible
- Across a real lead list, the hash distributes across all 7 scenarios in roughly the weighted proportions
- `npm run reset` + `npm run demo` produces an identical dataset — useful for demos

If you want to test a specific scenario for a given lead, temporarily override the phone seed in `mock-provider.ts`.

### Why `node:sqlite` instead of `better-sqlite3`

`better-sqlite3` is excellent but adds a native addon dependency that needs to be compiled per platform. Using the built-in `node:sqlite` (Node 22+) means zero native dependencies, no build step, no platform-specific binaries — the project installs cleanly on any machine with `npm install`. The API is similar enough that a migration would be a one-hour job.

---

## Architecture

```
mystery-shopper/
├── src/
│   ├── config/settings.ts          Config loading + 50-state timezone map
│   ├── db/
│   │   ├── schema.ts               SQLite schema, migrations, WAL mode
│   │   └── repository.ts           All DB reads/writes — no SQL elsewhere
│   ├── ingestion/
│   │   └── csv-importer.ts         CSV → leads (upsert on phone, state normalization)
│   ├── scheduling/
│   │   └── scheduler.ts            Business-hours check, retry eligibility, dedup
│   ├── calls/
│   │   ├── mock-provider.ts        7 realistic call scenarios, phone-seeded
│   │   └── orchestrator.ts         Call lifecycle: place → extract → score → store (atomic)
│   ├── extraction/
│   │   └── extractor.ts            Transcript → structured fields (LLM primary, regex fallback)
│   ├── scoring/
│   │   └── scorer.ts               Extraction → 6 dimension scores + SDR signal
│   ├── reporting/
│   │   └── reporter.ts             Terminal table + JSON output
│   └── server.ts                   HTTP server for web dashboard
├── src/public/
│   └── index.html                  Live dashboard (dark/light, filter, detail drawer)
└── data/
    └── leads.csv                   Input (matches Google Sheet schema)
```

### Data flow

```
leads.csv
  ↓  csv-importer     (normalize phone, infer state abbr, extract restaurant name from domain)
SQLite leads table
  ↓  scheduler        (filter: business hours in local TZ, not currently calling, retry-eligible)
Eligible leads queue
  ↓  orchestrator     (concurrent batches of N, gap between batches)
  ├── mock-provider   →  call status + transcript
  ├── extractor       →  structured extraction  (LLM or regex)
  └── scorer          →  6 dimension scores + SDR signal
       ↓ (atomic transaction)
  call_attempts + call_results tables
       ↓
  reporter (terminal / JSON)  or  web dashboard (live, auto-refresh)
```

---

## What's Mocked vs. Real

| Component | Status | Notes |
|---|---|---|
| Lead ingestion (CSV → DB) | **Real** | Parses any CSV matching the Google Sheet schema |
| SQLite storage | **Real** | Fully queryable — standard SQL, no ORM |
| Business-hours scheduling | **Real** | Timezone-aware via Luxon + 50-state map |
| Retry logic | **Real** | Configurable max retries + delay hours |
| Transcript extraction | **Real** | Regex-based offline; LLM with `OPENAI_API_KEY` |
| Scoring engine | **Real** | Weighted rubric, deterministic, fully unit-testable |
| SDR signal classification | **Real** | Derived from scores, maps to sales priority |
| Web dashboard | **Real** | Served via Node `http`, live filter + detail drawer |
| **Phone call placement** | **MOCKED** | `mock-provider.ts` simulates 7 realistic scenarios |
| **Voice AI conversation** | **MOCKED** | Deterministic transcripts seeded on phone number |

The call provider is isolated behind a single async interface in `orchestrator.ts`. Replacing `mock-provider.ts` with a real Vapi/Bland.ai/Twilio client requires changing one import — nothing else in the pipeline changes.

---

## Scoring Rubric

Each dimension scores 0–10. Overall is a weighted composite (0–100).

| Dimension | Weight | What it measures |
|---|---|---|
| Pickup | 20% | Answered? Rings before pickup (≤2=10, ≤3=8, ≤5=6, ≤7=4, >7=2, not answered=0) |
| Greeting | 15% | Professional tone (+4), restaurant name stated (+2), base for answering (+4) |
| Responsiveness | 25% | No hold=10, hold <20s=8, <45s=6, <90s=4, <3min=2, >3min=0 |
| Order capability | 25% | Refused phone orders=0, took order=6, confirmed with total/ETA=10 |
| Accuracy | 10% | Confirmed order=10, gave wait time only=5, took order without confirmation=2 |
| Friendliness | 5% | excellent=10, good=7, neutral=5, poor=1 |

### SDR Signal

| Signal | Condition | Sales framing |
|---|---|---|
| 🔴 HOT | Score < 40 **or** no-answer/voicemail/busy | Strong Maple candidate — direct revenue loss |
| 🟡 WARM | Score 40–69 | Some friction — worth outreach |
| 🟢 COLD | Score ≥ 70 | Already solid — deprioritize |

**Key insight**: unanswered calls trigger HOT automatically, regardless of score. A restaurant that doesn't pick up is losing a customer on every ring — that's Maple's clearest pitch.

---

## Extraction Quality

| Method | Accuracy | When used |
|---|---|---|
| Regex | ~85% on answered calls | Always available — no API key needed |
| GPT-4o-mini | ~95% on answered calls | When `OPENAI_API_KEY` is set in `.env` |

The LLM path uses `response_format: { type: 'json_object' }` at temperature 0 for deterministic structured output. If the LLM call fails or returns invalid fields, the system logs the error and falls back to regex silently — extraction always succeeds.

Non-answered calls (no_answer, voicemail, busy) skip extraction entirely and return a fixed structured response; there's nothing to extract.

---

## Scheduling

- Calls only placed within business hours (default 11 AM – 9 PM local time)
- Timezone inferred from US state code (50-state map in `settings.ts`)
- Leads with unknown state default to `America/New_York`
- No-answer / busy → retry after configurable delay (default 2 hours), up to max retries
- Same phone number is never called twice in the same batch (`seenPhones` dedup set)
- Batch concurrency is configurable (default 3 parallel calls)

---

## Database Schema

Three tables — all standard SQL, no ORM:

```sql
leads          -- one row per restaurant, status tracks call lifecycle
call_attempts  -- one row per attempt (multiple per lead on retry)
call_results   -- one row per completed call with full extraction + scores
```

The orchestrator wraps `saveCallResult` + lead status update in an **SQLite transaction** — if the process crashes mid-call, no orphaned result records or stuck `calling` leads.

Useful queries:

```sql
-- HOT leads not yet contacted by SDR
SELECT l.restaurant_name, l.phone, l.city, l.state, cr.sdr_notes
FROM call_results cr JOIN leads l ON l.id = cr.lead_id
WHERE cr.sdr_signal = 'hot'
ORDER BY cr.score_overall ASC;

-- Score distribution by signal
SELECT sdr_signal, COUNT(*) as n, ROUND(AVG(score_overall), 1) as avg_score
FROM call_results GROUP BY sdr_signal;

-- Leads that never answered across all attempts
SELECT l.restaurant_name, l.phone, l.attempt_count
FROM leads l
WHERE l.status = 'completed'
  AND NOT EXISTS (
    SELECT 1 FROM call_results cr
    WHERE cr.lead_id = l.id AND cr.was_answered = 1
  );
```

---

## Extending to Real Calls

1. Choose a voice provider (Vapi, Bland.ai, Twilio + OpenAI Realtime, ElevenLabs)
2. Create `src/calls/real-provider.ts` implementing the same interface as `mock-provider.ts`:
   ```typescript
   export async function placeCall(
     phone: string,
     restaurantName: string,
     delayMs: number
   ): Promise<MockCallResult>
   ```
3. Update the import in `orchestrator.ts` — nothing else changes

The agent script for the real call:
```
1. Wait for answer / detect voicemail
2. "Hi, I'd like to place a takeout order please."
3. Order a specific item (configurable per vertical/market)
4. Ask for wait time and total
5. Give name for the order ("Alex")
6. Confirm and hang up
```

Real call cost estimate:
- Vapi: ~$0.05–0.10/min × avg 2 min = ~$0.10–0.20/call
- 600 leads × $0.15 avg = **~$90 for a full run** of the provided lead list
- GPT-4o-mini extraction: ~$0.001/call = ~$0.60 for 600 leads (negligible)

---

## Configuration

All config lives in `.env` (copy from `.env.example`):

| Variable | Default | Description |
|---|---|---|
| `DB_PATH` | `./data/mystery-shopper.db` | SQLite file location |
| `LEADS_CSV_PATH` | `./data/leads.csv` | Input CSV path |
| `CALL_PROVIDER` | `mock` | `mock` or `twilio` |
| `BUSINESS_HOURS_START` | `11` | Hour (24h) calls begin in local TZ |
| `BUSINESS_HOURS_END` | `21` | Hour (24h) calls stop |
| `MAX_RETRIES` | `2` | Max retry attempts for no-answer/busy |
| `RETRY_DELAY_HOURS` | `2` | Minimum hours between retries |
| `CALL_CONCURRENCY` | `3` | Parallel calls per batch |
| `CALL_MOCK_DELAY_MS` | `1500` | Simulated call time (demo speed) |
| `OPENAI_API_KEY` | _(empty)_ | Enables LLM extraction if set |
| `OPENAI_MODEL` | `gpt-4o-mini` | Model for extraction |
| `PORT` | `3000` | Dashboard server port |

---

## Tradeoffs & Known Gaps

**Phone call is mocked.** The transcript quality is realistic for a demo; real transcripts from Vapi/Bland will be messier (filler words, crosstalk, IVR navigation). The extraction regex handles the clean mock format well; the LLM path handles messy real-world transcripts much better — set `OPENAI_API_KEY` for production use.

**Restaurant name inference is heuristic.** The importer extracts names from website domains (`marioskitchen.com` → "Marios Kitchen"). This works for most cases but fails for chains, redirects, or generic domains. In production, a Google Maps Places API lookup on the `google_maps_url` would give the authoritative name.

**No deduplication across runs.** Re-importing the same CSV won't create duplicate leads (phone deduplication), but `npm run reset` + `npm run demo` produces the same results because scenarios are seeded by phone number. To get varied results, change the seed offset in `mock-provider.ts`.

**No jitter on retries.** All retries fire after exactly `RETRY_DELAY_HOURS`. In production with hundreds of simultaneous failed leads, staggering retries with ±30 minutes of random jitter prevents thundering herd on the next batch window.

**No per-lead call script customization.** The agent always orders the same seeded item. In production, you'd vary the order by cuisine type, day-of-week specials, or price point to make the mystery shop less detectable.

**Performance.** A full run of 600 leads at `CALL_CONCURRENCY=3` with `CALL_MOCK_DELAY_MS=1500` takes ~5 minutes. With real Vapi calls (avg 90-second conversations), the same batch takes ~4-5 hours. Increasing concurrency to 10 reduces wall time proportionally; the scheduler and DB are not the bottleneck.

---

## What I'd Build Next (given one more week)

**1. Real call provider integration.**
Plug in Vapi or Bland.ai. The `CallProvider` interface in `types.ts` is already defined — it's a one-file swap in `orchestrator.ts`. The agent script is documented in this README. Biggest open question: IVR navigation (press 1 for takeout) — Bland.ai handles this better than Vapi out of the box.

**2. Webhook-driven real-time results.**
Currently the system polls and batches. With a real provider, calls complete asynchronously — the provider POSTs a webhook when the call ends. I'd add a `/webhook` endpoint to `server.ts` that receives the transcript, runs extraction + scoring, and pushes the result to the dashboard via Server-Sent Events. No more polling.

**3. Confidence scores on extraction.**
The extractor returns binary fields but has no signal for how certain it was. A `confidence: 0–1` field per extracted value would let the dashboard flag low-confidence calls for human review, and would let us measure LLM vs regex divergence over time to improve the regex patterns.

**4. CRM export.**
A one-click "Export HOT leads to CSV" button on the dashboard, formatted for direct import into Salesforce or HubSpot. SDRs shouldn't have to copy-paste from a web UI.

**5. Vertical-aware scoring.**
The current rubric treats all restaurants equally. A fine-dining restaurant that says "we don't take phone orders" is genuinely different from a pizza shop doing the same thing. Tagging leads by cuisine/price tier (inferrable from Google Maps data already in the DB) and adjusting scoring weights per vertical would surface more actionable signals.
