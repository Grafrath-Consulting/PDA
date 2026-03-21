/**
 * Seed script: generates 150 realistic journal entries (50 per workspace)
 * and inserts them into the Supabase database.
 *
 * Usage: node scripts/seed-test-data.js
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ---------------------------------------------------------------------------
// Load .env.local
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Realistic journal content templates
// ---------------------------------------------------------------------------
const CONTENT_TEMPLATES = [
  // Work / meetings
  "Had a productive standup this morning. The team is making great progress on the new dashboard feature. We discussed some edge cases around pagination and decided to handle them in the next sprint. Sarah brought up a good point about accessibility that we need to address.",
  "Sprint retrospective went well today. The team agreed that our velocity has improved significantly over the past few weeks. We identified a few bottlenecks in the deployment pipeline that need attention. Action items were assigned and we should see improvements by next sprint.",
  "Code review session with the backend team took most of the afternoon. Found a couple of potential memory leaks in the caching layer. Also suggested switching from polling to websockets for real-time updates. The team was receptive to the changes.",
  "Client call at 2pm went better than expected. They loved the new reporting feature and asked about adding export to PDF. Need to scope that out for Q2 planning. Follow-up meeting scheduled for next Thursday.",
  "Spent the morning debugging a tricky race condition in the notification system. Turned out the issue was related to concurrent database writes. Added proper locking and the tests are passing now.",
  "Quarterly planning meeting. We reviewed OKRs and adjusted priorities. The main focus for next quarter will be performance optimization and international expansion. Need to hire two more engineers.",
  "Onboarding the new junior developer today. Walked through the codebase architecture, our branching strategy, and CI/CD pipeline. They seem sharp and asked good questions about our testing approach.",
  "Database migration went smoothly during the maintenance window. Moved about 2 million rows to the new partitioned table structure. Query performance improved by roughly 40% on the most common queries.",
  "Architecture discussion about migrating to microservices. We decided to start with the payment service as a pilot. Need to set up service mesh and proper observability before we proceed.",
  "Pair programming session with Alex on the search feature. We implemented fuzzy matching using trigram indexes. The results are much more relevant now and users should notice a big improvement.",

  // Personal reflections
  "Feeling good about the progress I've made this week. Finally got into a solid morning routine — wake up at 6, workout, journal, then start work by 8. The structure really helps with focus and energy levels throughout the day.",
  "Reflecting on the past month. I've been better about setting boundaries between work and personal time. Still need to work on saying no to things that don't align with my priorities. Reading 'Essentialism' has been helpful.",
  "Had a great conversation with my mentor today. She challenged me to think bigger about my career trajectory. Instead of focusing on the next promotion, think about what kind of impact I want to have in five years.",
  "Gratitude note: thankful for the supportive team I work with, the comfortable home office setup, and the fact that I can walk my dog during lunch breaks. Small things that make a big difference.",
  "Need to be more intentional about screen time in the evenings. Been falling into the habit of scrolling social media before bed, which definitely affects sleep quality. Going to try reading instead.",
  "Journaling about my goals for the next quarter. Want to: complete the AWS certification, start a side project using Rust, read at least 5 books, and establish a consistent meditation practice.",
  "Took a mental health day today. Went for a long hike in the mountains, had lunch at that little cafe by the trailhead, and spent the afternoon reading in the park. Feeling recharged.",

  // Daily life / observations
  "Beautiful sunrise this morning. The sky was a gradient of pink and orange that lasted about twenty minutes. Managed to capture a few photos from the balcony. Need to get up early more often.",
  "Noticed the cherry blossoms are starting to bloom along the street. Spring is finally here. The whole neighborhood feels different when there's color everywhere.",
  "Rainy day. Perfect weather for staying in and catching up on reading. Made a big pot of soup and worked through a couple of chapters of the design patterns book.",
  "The new coffee shop on Main Street is excellent. They roast their own beans and the barista recommended a Ethiopian single origin that was incredibly smooth. Will definitely go back.",
  "Farmers market this Saturday was packed. Got some beautiful heirloom tomatoes, fresh basil, and a loaf of sourdough. Planning to make bruschetta tonight.",
  "Power went out for about three hours this afternoon. Used the time to organize the garage and clean out some old boxes. Found my college notebooks — interesting to see what I was thinking about ten years ago.",

  // Cooking / food
  "Tried a new recipe for Thai green curry tonight. Used fresh lemongrass and galangal from the Asian market. The coconut milk sauce came out perfectly creamy. Added extra Thai basil at the end which made a huge difference.",
  "Meal prep Sunday. Made chicken tikka masala, roasted vegetables, and brown rice for the week. Also prepped overnight oats with chia seeds and berries for breakfasts. Should save a lot of time during the busy week ahead.",
  "Baked sourdough for the first time in months. The starter needed a few days of feeding to get active again, but the final loaf had a great oven spring and nice open crumb. Shared half with the neighbors.",
  "Experimenting with fermentation. Started a batch of kimchi using the traditional method. Also have kombucha on its second ferment with ginger and lemon. The kitchen smells interesting.",

  // Exercise / health
  "Morning run along the river trail. Did 5K in 24 minutes, which is a personal best for this year. The cool weather helped a lot. Legs felt strong and breathing was steady throughout.",
  "Started a new strength training program focused on compound movements. Squats, deadlifts, bench press, and overhead press three times a week. Keeping the weight moderate and focusing on form for the first month.",
  "Yoga class this evening was exactly what I needed after sitting at a desk all day. The instructor focused on hip openers and shoulder stretches. My hamstrings are noticeably tighter than they were a few months ago.",
  "Annual physical checkup went well. All bloodwork came back normal. Doctor recommended increasing vitamin D intake and getting more sleep. Going to aim for 7.5 hours minimum per night.",
  "Cycling to work today instead of driving. The 8-mile route takes about 35 minutes and goes through some nice residential streets. Good cardio and saves gas. Will try to do this at least twice a week.",

  // Technology / learning
  "Deep dive into WebAssembly today. The performance gains for compute-heavy tasks are impressive. Wrote a small image processing module in Rust and compiled it to WASM. The browser ran it about 10x faster than the equivalent JavaScript.",
  "Set up a home lab server using an old laptop. Installed Proxmox and created a few VMs for experimenting with Kubernetes. Also set up Pi-hole for network-wide ad blocking. The family hasn't noticed any difference.",
  "Finished the distributed systems course on Coursera. The sections on consensus algorithms (Paxos and Raft) were particularly interesting. Going to try implementing a simplified version of Raft as a learning exercise.",
  "Reading about the latest developments in AI. The pace of progress is remarkable. Spent some time experimenting with local LLMs and was surprised by how capable the smaller models have become.",
  "Upgraded my development environment. Switched to Neovim with a custom config, set up tmux properly, and configured fzf for fuzzy finding. The keyboard-driven workflow is much faster once you get past the learning curve.",

  // Plans / todos
  "Planning the weekend trip to the coast. Need to book the Airbnb, check the weather forecast, pack the camera gear, and make a playlist for the drive. Also should get the car washed and check tire pressure.",
  "Things to organize this week: clean out the closet and donate old clothes, schedule the dentist appointment I've been putting off, renew the gym membership, and call about the internet upgrade.",
  "Working on the budget for next month. Rent, utilities, groceries, and subscriptions are pretty fixed. Want to allocate more toward savings and reduce dining out expenses. The 50/30/20 rule seems like a good framework.",
  "Project timeline for the home renovation. Phase 1: bathroom remodel (2 weeks). Phase 2: kitchen backsplash (3 days). Phase 3: paint the living room (weekend project). Need to get quotes from contractors this week.",

  // Random thoughts / creative
  "Interesting idea: what if productivity apps focused less on task management and more on energy management? Instead of scheduling by time, schedule by energy level — creative work when you're most alert, admin tasks during low-energy periods.",
  "Watched a documentary about deep ocean exploration last night. The bioluminescent creatures at 3,000 meters are otherworldly. There's so much we still don't know about our own planet.",
  "Started writing a short story about a librarian who discovers that books rearrange themselves overnight. Not sure where it's going yet, but the premise feels fun. Wrote about 800 words during my lunch break.",
  "Thinking about minimalism and how it applies to digital life. Unsubscribed from 30 newsletters today, deleted apps I haven't used in months, and organized my bookmarks. Digital decluttering feels just as satisfying as physical.",
  "The concept of 'slow productivity' is growing on me. Rather than optimizing for output, optimize for meaningful work done at a sustainable pace. Quality over quantity, depth over breadth.",

  // Meetings and collaboration
  "Workshop on effective communication today. Key takeaways: lead with context, be specific about asks, and always clarify next steps. Simple principles but easy to forget in the rush of daily work.",
  "Brainstorming session for the product roadmap. Generated about forty ideas, then dot-voted to narrow down to the top ten. The team is most excited about the AI-powered recommendations feature.",
  "One-on-one with my manager. Discussed career growth, current project challenges, and feedback from the recent peer review. Positive overall, with some actionable areas for improvement around delegation.",
  "Cross-team sync about the API versioning strategy. Agreed on semantic versioning with a deprecation policy of at least six months. Need to document the migration guides before the next release.",

  // Weekend / leisure
  "Lazy Sunday morning. Made pancakes with blueberries, read the newspaper with coffee, then took the dog to the park. Sometimes the simplest days are the best ones.",
  "Game night with friends. Played Catan and a few rounds of Codenames. I'm still terrible at Catan but won two rounds of Codenames. Great evening with good company and too much pizza.",
  "Visited the art museum downtown. The new contemporary exhibit features interactive installations that respond to movement and sound. Spent almost two hours there. The piece with projected light on water was stunning.",
  "Saturday morning at the bookstore. Picked up three books: a novel by Ursula Le Guin, a history of jazz, and a cookbook focused on plant-based meals. The reading list keeps growing faster than I can read.",
  "Movie marathon with old classics. Watched Casablanca, Rear Window, and Some Like It Hot. The writing and performances in these films hold up remarkably well. They don't make dialogue like that anymore.",

  // Task-oriented entries
  "Need to review and merge the pull requests from this week. There are about seven open PRs, three of which need significant review. Also need to update the CI configuration to add the new linting rules.",
  "Follow up with the design team about the new onboarding flow. The wireframes looked good but I have concerns about the number of steps. Users should be able to get started in under two minutes.",
  "Prepare the presentation for the all-hands meeting on Friday. Need slides covering: Q1 results, team highlights, upcoming product launches, and the hiring plan. Should rehearse at least once before Thursday.",
  "Server maintenance scheduled for this weekend. Need to update the OS, apply security patches, rotate SSL certificates, and test the backup restoration process. Should take about four hours with verification.",
  "Write the technical specification for the new authentication system. Should cover OAuth 2.0 integration, session management, token refresh strategy, and the migration plan from the current system.",
  "Bug investigation: users reporting intermittent 500 errors on the checkout page. Need to check the payment gateway logs, review recent deployments, and set up better error monitoring for that endpoint.",

  // Short entries
  "Quick note: the API key for the staging environment expires next Tuesday. Need to rotate it before then.",
  "Reminder to water the plants. The fern in the living room is looking a bit dry.",
  "Picked up dry cleaning. Need to drop off the shoes for repair tomorrow.",
  "Good progress on the side project today. Got the basic CRUD operations working.",
  "Interesting article about urban planning and walkable cities. Saved it to read later.",
  "Note to self: check the flight prices for the summer trip. Prices tend to go up after March.",

  // Longer reflective entries
  "End of year reflection. Looking back at what I set out to accomplish versus what actually happened. Some goals were hit — I did complete the certification and read more books than planned. Others fell by the wayside, mostly the creative projects I was excited about in January. The lesson is probably about being more realistic with commitments and protecting time for the things that matter most. Next year I want to focus on fewer things but go deeper with each one. Quality of experience over quantity of accomplishments.",
  "Thinking about the balance between planning and spontaneity. I tend to over-plan everything, which gives me a sense of control but sometimes squeezes out the serendipitous moments that make life interesting. This weekend I deliberately left Saturday unplanned and ended up having one of the best days in recent memory — discovered a new hiking trail, had a random conversation with a stranger at a coffee shop that turned into a two-hour discussion about philosophy, and caught a beautiful sunset I would have missed if I'd been rushing to the next scheduled activity.",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function randomDate(start, end) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function wrapHtml(text) {
  // Split into sentences and group into paragraphs of 2-4 sentences
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const paragraphs = [];
  let i = 0;
  while (i < sentences.length) {
    const count = Math.min(2 + Math.floor(Math.random() * 3), sentences.length - i);
    paragraphs.push(sentences.slice(i, i + count).join('').trim());
    i += count;
  }
  return paragraphs.map(p => `<p>${p}</p>`).join('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('Fetching existing data from database...');

  // 1. Get user_id from existing journal blocks or profiles
  const { data: existingBlocks, error: blocksErr } = await supabase
    .from('journal_blocks')
    .select('user_id')
    .limit(1);

  let userId;
  if (existingBlocks && existingBlocks.length > 0) {
    userId = existingBlocks[0].user_id;
  } else {
    const { data: profiles } = await supabase.from('profiles').select('id').limit(1);
    if (!profiles || profiles.length === 0) {
      console.error('No users found in database');
      process.exit(1);
    }
    userId = profiles[0].id;
  }
  console.log(`Using user_id: ${userId}`);

  // 2. Get workspaces
  const { data: workspaces, error: wsErr } = await supabase
    .from('workspaces')
    .select('id, name')
    .eq('user_id', userId);

  if (wsErr || !workspaces || workspaces.length === 0) {
    console.error('No workspaces found:', wsErr);
    process.exit(1);
  }
  console.log(`Found ${workspaces.length} workspaces:`, workspaces.map(w => w.name).join(', '));

  // Use first 3 workspaces (or all if fewer)
  const targetWorkspaces = workspaces.slice(0, 3);
  if (targetWorkspaces.length < 3) {
    console.warn(`Warning: only ${targetWorkspaces.length} workspaces found, will distribute entries across those.`);
  }

  // 3. Get properties and property values
  const { data: properties } = await supabase
    .from('properties')
    .select('id, name')
    .eq('user_id', userId);

  console.log(`Found ${(properties || []).length} properties:`, (properties || []).map(p => p.name).join(', '));

  const propertyIds = (properties || []).map(p => p.id);
  let propertyValues = [];
  if (propertyIds.length > 0) {
    const { data: pvs } = await supabase
      .from('property_values')
      .select('id, property_id, label')
      .in('property_id', propertyIds);
    propertyValues = pvs || [];
  }
  console.log(`Found ${propertyValues.length} property values`);

  // Group property values by property
  const pvByProperty = {};
  for (const pv of propertyValues) {
    if (!pvByProperty[pv.property_id]) pvByProperty[pv.property_id] = [];
    pvByProperty[pv.property_id].push(pv);
  }

  // 4. Generate entries
  const NOW = new Date('2026-03-21T12:00:00Z');
  const ONE_YEAR_AGO = new Date('2025-03-21T00:00:00Z');
  const ENTRIES_PER_WORKSPACE = 50;

  const shuffledContent = shuffleArray(CONTENT_TEMPLATES);
  const allEntries = [];
  const entryPropertyLinks = [];
  let contentIdx = 0;

  for (const ws of targetWorkspaces) {
    for (let i = 0; i < ENTRIES_PER_WORKSPACE; i++) {
      const content = shuffledContent[contentIdx % shuffledContent.length];
      contentIdx++;

      const createdAt = randomDate(ONE_YEAR_AGO, NOW);
      const isTask = Math.random() < 0.2;
      const isArchived = i < 20; // first 20 per workspace get archived
      const archivedAt = isArchived
        ? randomDate(createdAt, NOW)
        : null;
      const sortOrder = (ENTRIES_PER_WORKSPACE - i) + Math.random();

      // Generate a varied updated_at: 30% same as created, rest spread across hours/days/weeks/months
      const maxGap = NOW.getTime() - createdAt.getTime();
      const roll = Math.random();
      let modGap;
      if (roll < 0.30) {
        modGap = 0; // never modified
      } else if (roll < 0.55) {
        modGap = (60 * 1000) + Math.random() * (12 * 60 * 60 * 1000); // minutes to hours
      } else if (roll < 0.75) {
        modGap = (24 * 60 * 60 * 1000) + Math.random() * (6 * 24 * 60 * 60 * 1000); // 1-7 days
      } else if (roll < 0.90) {
        modGap = (7 * 24 * 60 * 60 * 1000) + Math.random() * (21 * 24 * 60 * 60 * 1000); // 1-4 weeks
      } else {
        modGap = (30 * 24 * 60 * 60 * 1000) + Math.random() * (150 * 24 * 60 * 60 * 1000); // 1-6 months
      }
      modGap = Math.min(modGap, maxGap);
      const updatedAt = new Date(createdAt.getTime() + modGap);

      const entry = {
        user_id: userId,
        workspace_id: ws.id,
        content: content,
        content_html: wrapHtml(content),
        entry_type: isTask ? 'task' : 'info',
        status: isArchived ? 'archived' : 'active',
        archived_at: archivedAt ? archivedAt.toISOString() : null,
        created_at: createdAt.toISOString(),
        updated_at: updatedAt.toISOString(),
        sort_order: sortOrder,
        pinned: false,
        is_archived: isArchived,
      };

      allEntries.push({ entry, wsName: ws.name, applyProperties: Math.random() < 0.4 });
    }
  }

  console.log(`\nGenerated ${allEntries.length} entries. Inserting in batches...`);

  // 5. Insert in batches of 25
  const BATCH_SIZE = 25;
  const insertedIds = [];

  for (let i = 0; i < allEntries.length; i += BATCH_SIZE) {
    const batch = allEntries.slice(i, i + BATCH_SIZE);
    const rows = batch.map(b => b.entry);

    const { data: inserted, error: insertErr } = await supabase
      .from('journal_blocks')
      .insert(rows)
      .select('id');

    if (insertErr) {
      console.error(`Error inserting batch ${i / BATCH_SIZE + 1}:`, insertErr);
      process.exit(1);
    }

    for (let j = 0; j < inserted.length; j++) {
      insertedIds.push({
        id: inserted[j].id,
        applyProperties: batch[j].applyProperties,
      });
    }

    console.log(`  Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allEntries.length / BATCH_SIZE)}`);
  }

  console.log(`\nInserted ${insertedIds.length} entries total.`);

  // 6. Apply property tags to ~40% of entries
  const allPvIds = propertyValues.map(pv => pv.id);
  const propertyIdsList = Object.keys(pvByProperty);

  if (propertyIdsList.length > 0) {
    const epRows = [];
    for (const entry of insertedIds) {
      if (!entry.applyProperties) continue;

      // Pick 1-2 random property groups, then a random value from each
      const propsToApply = shuffleArray(propertyIdsList).slice(0, 1 + Math.floor(Math.random() * Math.min(2, propertyIdsList.length)));
      for (const propId of propsToApply) {
        const values = pvByProperty[propId];
        if (values && values.length > 0) {
          const pv = pickRandom(values);
          epRows.push({
            entry_id: entry.id,
            property_value_id: pv.id,
          });
        }
      }
    }

    if (epRows.length > 0) {
      console.log(`\nApplying ${epRows.length} property tags...`);
      for (let i = 0; i < epRows.length; i += BATCH_SIZE) {
        const batch = epRows.slice(i, i + BATCH_SIZE);
        const { error: epErr } = await supabase
          .from('entry_properties')
          .insert(batch);

        if (epErr) {
          console.error(`Error inserting entry_properties batch:`, epErr);
          // Don't exit — property linking is non-critical
        }
      }
      console.log(`  Property tags applied.`);
    }
  }

  // 7. Spread ALL existing entries across the past year
  console.log('\nUpdating dates on ALL existing entries to span the past year...');

  const { data: allBlocks, error: allErr } = await supabase
    .from('journal_blocks')
    .select('id, status, archived_at')
    .eq('user_id', userId);

  if (allErr) {
    console.error('Error fetching all blocks:', allErr);
  } else {
    // Shuffle and assign dates spread across the year
    const shuffledBlocks = shuffleArray(allBlocks);
    const totalBlocks = shuffledBlocks.length;

    for (let i = 0; i < totalBlocks; i++) {
      const block = shuffledBlocks[i];
      // Spread evenly across the year with some jitter
      const fraction = i / totalBlocks;
      const baseTime = ONE_YEAR_AGO.getTime() + fraction * (NOW.getTime() - ONE_YEAR_AGO.getTime());
      const jitter = (Math.random() - 0.5) * 3 * 24 * 60 * 60 * 1000; // +/- 1.5 days
      const newDate = new Date(Math.max(ONE_YEAR_AGO.getTime(), Math.min(NOW.getTime(), baseTime + jitter)));

      // Generate varied updated_at (always >= created_at)
      const maxGap = NOW.getTime() - newDate.getTime();
      const roll = Math.random();
      let modGap;
      if (roll < 0.30) {
        modGap = 0;
      } else if (roll < 0.55) {
        modGap = (60 * 1000) + Math.random() * (12 * 60 * 60 * 1000);
      } else if (roll < 0.75) {
        modGap = (24 * 60 * 60 * 1000) + Math.random() * (6 * 24 * 60 * 60 * 1000);
      } else if (roll < 0.90) {
        modGap = (7 * 24 * 60 * 60 * 1000) + Math.random() * (21 * 24 * 60 * 60 * 1000);
      } else {
        modGap = (30 * 24 * 60 * 60 * 1000) + Math.random() * (150 * 24 * 60 * 60 * 1000);
      }
      modGap = Math.min(modGap, maxGap);
      const updatedDate = new Date(newDate.getTime() + modGap);

      const updateData = {
        created_at: newDate.toISOString(),
        updated_at: updatedDate.toISOString(),
      };

      // If archived, set archived_at to sometime after created_at
      if (block.status === 'archived') {
        const archiveDelay = Math.random() * 30 * 24 * 60 * 60 * 1000; // up to 30 days later
        const archiveDate = new Date(Math.min(NOW.getTime(), newDate.getTime() + archiveDelay));
        updateData.archived_at = archiveDate.toISOString();
      }

      // Note: the on_block_updated trigger will override updated_at to now().
      // To set custom updated_at, disable the trigger first or use a migration.
      const { error: upErr } = await supabase
        .from('journal_blocks')
        .update(updateData)
        .eq('id', block.id);

      if (upErr) {
        console.error(`Error updating block ${block.id}:`, upErr);
      }
    }
    console.log(`  Updated dates on ${totalBlocks} entries.`);
  }

  console.log('\nSeed complete!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
