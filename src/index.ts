import { importCsv } from './ingestion/csv-importer';
import { getEligibleLeads } from './scheduling/scheduler';
import { runBatch } from './calls/orchestrator';
import { printFullReport, printJsonReport } from './reporting/reporter';
import { getDb } from './db/schema';
import { countLeads } from './db/repository';
import { config } from './config/settings';
import path from 'path';

const [,, command, ...args] = process.argv;

async function main(): Promise<void> {
  switch (command) {
    case 'import':
      cmdImport();
      break;
    case 'run':
      await cmdRun();
      break;
    case 'report':
      cmdReport(args.includes('--json'));
      break;
    case 'demo':
      await cmdDemo();
      break;
    case 'reset':
      cmdReset();
      break;
    default:
      printHelp();
  }
}

function cmdImport(): void {
  const csvPath = args[0] ?? config.leads.csvPath;
  console.log(`\nImporting leads from: ${csvPath}`);

  try {
    const result = importCsv(csvPath);
    console.log(`\n  Imported : ${result.imported}`);
    console.log(`  Updated  : ${result.updated}`);
    console.log(`  Skipped  : ${result.skipped}`);
    if (result.errors.length > 0) {
      console.log(`  Errors   : ${result.errors.length}`);
      for (const e of result.errors.slice(0, 5)) console.log(`    • ${e}`);
    }
    const { total } = countLeads();
    console.log(`\n  Total leads in DB: ${total}`);
    console.log('\nNext step: npm run run\n');
  } catch (err) {
    console.error(`Import failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

async function cmdRun(): Promise<void> {
  console.log('\nFinding eligible leads...');
  const eligible = getEligibleLeads();

  if (eligible.length === 0) {
    console.log(
      '\nNo eligible leads found. Possible reasons:\n' +
      '  • No pending leads (run: npm run import first)\n' +
      '  • All leads are outside business hours in their timezone\n' +
      '  • All leads have been called\n'
    );
    return;
  }

  console.log(`Found ${eligible.length} eligible leads. Starting calls...\n`);

  const results = await runBatch(eligible);

  console.log('\n── Call Batch Complete ──');
  for (const r of results) {
    const signal =
      r.sdrSignal === 'hot'  ? '\x1b[31mHOT \x1b[0m' :
      r.sdrSignal === 'warm' ? '\x1b[33mWARM\x1b[0m' :
                               '\x1b[32mCOLD\x1b[0m';
    const score = r.overallScore > 0 ? ` [${r.overallScore}/100]` : '';
    console.log(`  ${signal}  ${r.restaurantName.padEnd(28)} ${r.callStatus.padEnd(12)}${score}`);
    if (r.error) console.log(`         ↳ Error: ${r.error}`);
  }

  console.log('\nView full report: npm run report\n');
}

function cmdReport(json: boolean): void {
  if (json) {
    printJsonReport();
  } else {
    printFullReport();
  }
}

async function cmdDemo(): Promise<void> {
  // --limit N: how many leads to call (default 30 for quick demo)
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : 30;

  console.log('\n\x1b[1m\x1b[36mRunning DEMO — importing leads & running mock calls\x1b[0m\n');

  const sampleCsvPath = path.join(process.cwd(), 'data', 'leads.csv');
  console.log('Step 1: Import leads');
  const importResult = importCsv(sampleCsvPath);
  console.log(`  Imported ${importResult.imported}, skipped ${importResult.skipped}\n`);

  console.log('Step 2: Check eligible leads');
  const eligible = getEligibleLeads();
  if (eligible.length === 0) {
    console.log('  No leads are eligible right now. Check business hours or run: npm run reset\n');
    printFullReport();
    return;
  }

  const scheduled = eligible.slice(0, limit);
  console.log(`  Running ${scheduled.length} of ${eligible.length} eligible leads (use --limit=N to change)\n`);

  console.log('Step 3: Run mock calls...');
  const results = await runBatch(scheduled);

  console.log('\n  Results:');
  for (const r of results) {
    const signal =
      r.sdrSignal === 'hot'  ? '\x1b[31mHOT \x1b[0m' :
      r.sdrSignal === 'warm' ? '\x1b[33mWARM\x1b[0m' :
                               '\x1b[32mCOLD\x1b[0m';
    console.log(`  ${signal}  ${r.restaurantName.padEnd(28)} ${r.callStatus.padEnd(12)} ${r.overallScore > 0 ? r.overallScore + '/100' : '—'}`);
  }

  console.log('\nStep 4: Full Report\n');
  printFullReport();
}

function cmdReset(): void {
  const db = getDb();
  db.exec(`
    DELETE FROM call_results;
    DELETE FROM call_attempts;
    UPDATE leads SET status = 'pending', attempt_count = 0, last_attempted_at = NULL;
  `);
  console.log('\nDatabase reset — all leads set back to pending.\n');
}

function printHelp(): void {
  console.log(`
\x1b[1mMystery Shopper\x1b[0m

Usage:
  npm run import [path/to/leads.csv]   Import leads from CSV
  npm run run                          Place calls for all eligible leads
  npm run report                       Print full human-readable report
  npm run report -- --json             Print JSON report (pipe to file)
  npm run demo                         Import sample data + run end-to-end demo
  npm run reset                        Reset all leads to pending (re-run calls)
  npm run serve                        Start web dashboard → http://localhost:3000
`);
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
