/**
 * Updates existing journal_blocks with varied updated_at timestamps.
 * Bypasses the on_block_updated trigger by temporarily disabling it,
 * updating the rows, then re-enabling it.
 *
 * Usage: node scripts/vary-modified-dates.js
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Load .env.local
const envPath = path.resolve(__dirname, '..', '.env.local');
const envText = fs.readFileSync(envPath, 'utf-8');
const env = {};
for (const line of envText.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
}

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  // Fetch all blocks with their created_at
  const { data: blocks, error } = await supabase
    .from('journal_blocks')
    .select('id, created_at')
    .order('created_at');

  if (error) {
    console.error('Error fetching blocks:', error);
    process.exit(1);
  }

  console.log(`Found ${blocks.length} blocks. Generating varied updated_at values...`);

  const now = new Date('2026-03-21T12:00:00Z');

  // Build update cases: for each block, pick a random updated_at between created_at and now.
  // Distribute the "modification gap" to create variety:
  //   ~30% same as created (never modified)
  //   ~25% modified within hours (quick edit)
  //   ~20% modified within days
  //   ~15% modified within weeks
  //   ~10% modified within months
  const updates = blocks.map(block => {
    const createdAt = new Date(block.created_at);
    const maxGap = now.getTime() - createdAt.getTime();
    const roll = Math.random();
    let gap;

    if (roll < 0.30) {
      // Never modified — keep updated_at = created_at
      gap = 0;
    } else if (roll < 0.55) {
      // Modified within minutes to hours (1 min to 12 hours)
      gap = (60 * 1000) + Math.random() * (12 * 60 * 60 * 1000);
    } else if (roll < 0.75) {
      // Modified within 1-7 days
      gap = (24 * 60 * 60 * 1000) + Math.random() * (6 * 24 * 60 * 60 * 1000);
    } else if (roll < 0.90) {
      // Modified within 1-4 weeks
      gap = (7 * 24 * 60 * 60 * 1000) + Math.random() * (21 * 24 * 60 * 60 * 1000);
    } else {
      // Modified within 1-6 months
      gap = (30 * 24 * 60 * 60 * 1000) + Math.random() * (150 * 24 * 60 * 60 * 1000);
    }

    // Clamp so updated_at doesn't exceed now
    gap = Math.min(gap, maxGap);
    const updatedAt = new Date(createdAt.getTime() + gap);

    return { id: block.id, updated_at: updatedAt.toISOString() };
  });

  // Build a single SQL statement that disables the trigger, does all updates, then re-enables it
  const BATCH_SIZE = 50;

  console.log('Disabling trigger...');
  const { error: disableErr } = await supabase.rpc('exec_sql', {
    query: 'ALTER TABLE journal_blocks DISABLE TRIGGER on_block_updated;'
  });

  if (disableErr) {
    // The exec_sql RPC may not exist — fall back to creating it first
    console.log('Creating exec_sql helper function...');
    const { error: createErr } = await supabase.rpc('exec_sql', { query: 'SELECT 1' });
    if (createErr) {
      // Need to create the function via SQL
      console.log('exec_sql not available. Creating it via raw REST...');

      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ query: 'SELECT 1' }),
      });

      if (!response.ok) {
        // Create the function using the SQL endpoint
        console.log('Creating exec_sql function via SQL API...');
        const sqlRes = await fetch(`${SUPABASE_URL}/rest/v1/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
          },
        });
        console.error('Cannot create exec_sql. Will use direct SQL via pg endpoint.');
        console.log('\nFalling back to batch UPDATE approach...');
        await fallbackUpdate(updates, BATCH_SIZE);
        return;
      }
    }

    // Try again
    const { error: retryErr } = await supabase.rpc('exec_sql', {
      query: 'ALTER TABLE journal_blocks DISABLE TRIGGER on_block_updated;'
    });
    if (retryErr) {
      console.log('Cannot disable trigger via RPC. Using SQL migration fallback...');
      await fallbackUpdate(updates, BATCH_SIZE);
      return;
    }
  }

  // Do the updates in batches
  console.log(`Updating ${updates.length} blocks in batches of ${BATCH_SIZE}...`);
  let updated = 0;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    // Build a single SQL UPDATE with CASE statement
    const cases = batch.map(u =>
      `WHEN '${u.id}' THEN '${u.updated_at}'::timestamptz`
    ).join('\n          ');
    const ids = batch.map(u => `'${u.id}'`).join(', ');

    const sql = `
      UPDATE journal_blocks
      SET updated_at = CASE id
          ${cases}
      END
      WHERE id IN (${ids});
    `;

    const { error: batchErr } = await supabase.rpc('exec_sql', { query: sql });
    if (batchErr) {
      console.error(`Error updating batch ${Math.floor(i / BATCH_SIZE) + 1}:`, batchErr);
    } else {
      updated += batch.length;
    }
    process.stdout.write(`  Updated ${updated}/${updates.length}\r`);
  }

  console.log(`\nRe-enabling trigger...`);
  await supabase.rpc('exec_sql', {
    query: 'ALTER TABLE journal_blocks ENABLE TRIGGER on_block_updated;'
  });

  console.log('Done! Modified dates have been varied.');
  printStats(updates, blocks);
}

async function fallbackUpdate(updates, batchSize) {
  // Build a SQL migration file instead and tell the user to push it
  console.log('\nGenerating SQL migration file instead...');

  let sql = '-- Temporarily disable the update trigger\n';
  sql += 'ALTER TABLE journal_blocks DISABLE TRIGGER on_block_updated;\n\n';

  for (const u of updates) {
    sql += `UPDATE journal_blocks SET updated_at = '${u.updated_at}'::timestamptz WHERE id = '${u.id}';\n`;
  }

  sql += '\n-- Re-enable the trigger\n';
  sql += 'ALTER TABLE journal_blocks ENABLE TRIGGER on_block_updated;\n';

  const migrationPath = path.resolve(__dirname, '..', 'supabase', 'migrations', '20260321500000_vary_modified_dates.sql');
  fs.writeFileSync(migrationPath, sql);
  console.log(`\nWrote migration file: ${migrationPath}`);
  console.log('Run: npx supabase db push');
}

function printStats(updates, blocks) {
  let sameCount = 0, hoursCount = 0, daysCount = 0, weeksCount = 0, monthsCount = 0;
  for (let i = 0; i < updates.length; i++) {
    const created = new Date(blocks[i].created_at);
    const updated = new Date(updates[i].updated_at);
    const gapHours = (updated - created) / (1000 * 60 * 60);

    if (gapHours < 0.02) sameCount++;       // < ~1 min
    else if (gapHours < 24) hoursCount++;
    else if (gapHours < 168) daysCount++;    // < 7 days
    else if (gapHours < 720) weeksCount++;   // < 30 days
    else monthsCount++;
  }
  console.log('\nDistribution:');
  console.log(`  Unmodified (same as created): ${sameCount}`);
  console.log(`  Modified within hours:        ${hoursCount}`);
  console.log(`  Modified within days:         ${daysCount}`);
  console.log(`  Modified within weeks:        ${weeksCount}`);
  console.log(`  Modified within months:       ${monthsCount}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
