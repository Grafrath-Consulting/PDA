/**
 * Extends 15 existing journal entries (5 per workspace) with much longer content.
 *
 * Usage: node scripts/extend-entries.js
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
// Long-form journal entries (500-1000 words each)
// ---------------------------------------------------------------------------
const LONG_ENTRIES = [
  // 1. Saturday day-in-the-life
  `<p>Woke up around 8:30 this morning which felt absolutely luxurious after a week of 6am alarms. The sunlight was streaming through the bedroom curtains in that particular golden way it does on Saturday mornings, and I just lay there for a few minutes enjoying the quiet. No alarms, no notifications demanding my attention, just the distant sound of birds and the occasional car passing on the street below.</p>

<p>Made myself a proper breakfast for once — scrambled eggs with chives from the little herb garden on the windowsill, some thick-cut bacon, and toast with real butter. Sat at the kitchen table actually eating instead of shoveling food down while staring at a screen. Read the weekend paper, which I know is old-fashioned, but there's something about the physical ritual of turning pages that feels different from scrolling. Found an interesting long-read about urban farming initiatives in Detroit that I ended up spending twenty minutes on.</p>

<p>After breakfast I tackled the kitchen cleanup that had been building up all week. Washed every dish, wiped down the counters, cleaned out the fridge of some questionable leftovers, and even mopped the floor. Put on a podcast about the history of jazz while I worked — there's something satisfying about combining physical cleaning with mental engagement. The episode was about Thelonious Monk and his approach to composition, how he'd spend hours working on a single phrase until it felt exactly right.</p>

<p>Around noon I walked down to the farmers market. The weather was perfect — mid-sixties, light breeze, clear blue sky. Picked up some beautiful heirloom tomatoes, a bunch of kale, fresh sourdough bread, and a jar of local honey. Chatted with the mushroom vendor about different ways to prepare lion's mane — he recommended slicing them thick, searing in butter with garlic, and finishing with a splash of soy sauce and lemon. Going to try that tonight.</p>

<p>The afternoon was wonderfully unstructured. Read for a while on the back porch, dozed off for maybe twenty minutes in the sun, then decided on a whim to walk down to the creek trail. The wildflowers are starting to come out — saw some early bluebells and what I think were trilliums. The trail was mostly empty except for a few dog walkers. Found a nice flat rock by the water and just sat there for a while, watching the light play on the surface of the creek. It's remarkable how restorative doing absolutely nothing can be.</p>

<p>Came home around 4pm and puttered around the house. Reorganized my bookshelf, which devolved into flipping through books and re-reading random passages. Got sucked into a chapter of a Bill Bryson book I'd forgotten I owned. Then I called my parents, which I've been meaning to do all week. Mom is planning her garden for spring and Dad is apparently learning to play the ukulele, which is both surprising and delightful. We talked for about forty-five minutes.</p>

<p>Made dinner with the farmers market haul — a big salad with the tomatoes and kale, the lion's mane mushrooms seared the way the vendor described (absolutely incredible, by the way), and the sourdough with honey. Ate on the porch as the sun went down. Sometimes the simplest days are the ones that feel the most full. No agenda, no productivity goals, just living. I need more Saturdays like this one.</p>`,

  // 2. Detailed work meeting recap
  `<p>Today's quarterly product review was one of the most consequential meetings we've had this year. It ran almost three hours, which is long even by our standards, but there was genuinely a lot of ground to cover. I want to capture the key decisions and action items while they're fresh in my mind because I know from experience that the details start to blur by Monday.</p>

<p>We started with Sarah presenting the Q1 metrics dashboard. Revenue is up 18% year-over-year, which is solid but slightly below the 22% target we set in January. The gap is mostly attributable to slower-than-expected enterprise adoption — our self-serve numbers are actually ahead of projections. Sarah made a compelling case that enterprise sales cycles are just taking longer because of the current economic uncertainty, not because of any product deficiency. The pipeline is healthy; the deals are just slower to close.</p>

<p>The most heated discussion was around the product roadmap prioritization. Engineering wants to spend Q2 on technical debt reduction — specifically, migrating from the legacy authentication system to OAuth 2.0, refactoring the payment processing pipeline, and upgrading the database layer. The sales team is pushing hard for three new features they say are blocking enterprise deals: SSO integration, advanced audit logging, and custom role-based access controls. After about forty minutes of going back and forth, we reached a compromise: dedicate 60% of engineering capacity to the infrastructure work and 40% to the top two enterprise features (SSO and audit logging). RBAC gets pushed to Q3.</p>

<p>Marcus from the design team presented the new onboarding flow mockups, which looked genuinely impressive. He's simplified the signup process from seven steps to three, added contextual tooltips, and created an interactive product tour that activates on first login. The user research behind it was thorough — they interviewed twenty new users and identified the exact friction points. The biggest drop-off was happening between account creation and first meaningful action, which the new flow addresses directly. I think this could meaningfully improve our activation rate.</p>

<p>We also discussed the AI feature strategy. The competitive landscape is shifting fast and several of our competitors have launched AI-powered features in the last quarter. Lisa proposed a phased approach: Phase 1 is AI-assisted content suggestions (relatively straightforward, uses existing API integrations), Phase 2 is intelligent workflow automation (more complex, requires new data pipeline), and Phase 3 is predictive analytics (long-term, needs significant R&D). The group agreed to greenlight Phase 1 with a target ship date of mid-May.</p>

<p>Action items I captured for my team specifically: (1) Complete the OAuth 2.0 migration plan by April 5th and share with the security team for review. (2) Provide technical feasibility assessment for SSO integration across our top five enterprise identity providers (Okta, Azure AD, OneLogin, Ping, Google Workspace) by April 12th. (3) Set up a shared Slack channel with the design team for the onboarding flow implementation. (4) Schedule a spike week for the AI content suggestions feature to validate the technical approach. (5) Update the engineering hiring plan to reflect the Q2 priorities and submit to HR by end of next week.</p>

<p>Personal takeaway from the meeting: I need to get better at pushing back on scope creep in real-time rather than absorbing commitments and then scrambling to deliver. When the sales team was listing their feature requests, I should have been more direct about the engineering cost and timeline implications. Instead I stayed quiet and now we're committed to a pretty aggressive Q2 plan. Going to practice being more assertive in these situations. Also need to follow up with Sarah about the enterprise pipeline data — I want to understand the specific deals that are stalling and whether there are patterns we can address proactively.</p>`,

  // 3. Travel/vacation journal
  `<p>Day three of the coastal road trip and I'm writing this from a tiny inn perched on the cliffs above the Pacific. The room is small and a bit rustic — creaky wooden floors, a quilt that's seen better days, a reading lamp that flickers when the wind picks up — but the view from the window is worth every penny. The ocean stretches out endlessly, dark blue fading to grey at the horizon, and the waves crash against the rocks below with a rhythm that's become the soundtrack of this trip.</p>

<p>We started the day early, driving north along the coastal highway just as the morning fog was burning off. The road here is incredible — narrow and winding, clinging to the edge of the cliffs with nothing but a low guardrail between you and a several-hundred-foot drop to the ocean. It's the kind of driving that demands your full attention, which is actually wonderful because it forces you to be completely present. No checking the phone, no drifting into work thoughts, just the road and the scenery and the salt air coming through the cracked windows.</p>

<p>Stopped at a beach around mid-morning that we found purely by accident. There was a small dirt pullout with a barely visible trail leading down through the brush. We followed it for about ten minutes, scrambling over rocks and ducking under branches, and emerged onto this pristine cove that was completely deserted. The sand was dark — almost black in places — and littered with smooth stones and shells. Tide pools along the edges were full of life: sea anemones, tiny crabs, hermit crabs hauling their borrowed shells around, purple sea urchins wedged into crevices in the rock. I could have spent hours there. We sat on a driftwood log and ate the sandwiches we'd packed, watching pelicans dive-bomb into the water with impressive precision.</p>

<p>After lunch we drove through a stretch of old-growth redwood forest. I've seen photos of the big trees but nothing prepares you for standing at the base of a tree that's been alive for a thousand years. The trunks are massive — wider than our car — and they go up and up until the canopy closes overhead and filters the light into these golden-green shafts. The forest floor is soft with centuries of fallen needles, and the air smells like earth and resin. There's a particular kind of silence in an old-growth forest that's different from any other quiet — it's not the absence of sound, exactly, but a kind of deep, layered stillness. We hiked a three-mile loop trail and barely spoke, which felt appropriate.</p>

<p>The small town we passed through in the late afternoon was one of those places that feels suspended in time. A main street with a hardware store, a diner, a used bookshop, and a bar that's clearly been serving the same community for decades. We stopped at the diner for coffee and pie. The woman behind the counter was probably in her seventies and called everyone "hon." The pie was blackberry, made that morning, and it was extraordinary — the kind of pie that makes you briefly reconsider your entire life and wonder if you should just move to a small town on the coast and eat pie every day.</p>

<p>Arrived at the inn around sunset. The owner, a retired marine biologist, showed us to our room and told us that gray whales should be migrating through this stretch of coast right now. She lent us a pair of binoculars and said to watch from the bluff behind the inn just before dusk. We stood out there for maybe thirty minutes, scanning the water, and were rewarded with three separate spouts — distant, but unmistakable. There's something profoundly moving about seeing a whale in the wild, even from a distance. The scale of them, the ancientness, the fact that they're out there living their enormous lives in an environment we can barely access.</p>

<p>Tomorrow we're heading further north. No fixed plans, no reservations, no timeline. Just the road and whatever we find along the way. This is exactly the kind of trip I needed — a reminder that the world is bigger and more interesting than the rectangle of my laptop screen.</p>`,

  // 4. Cooking adventure
  `<p>I decided today was the day I was finally going to attempt homemade pasta from scratch. Not just any pasta — I was going to make filled pasta. Specifically, butternut squash ravioli with brown butter and sage, a dish I've ordered in restaurants probably fifty times but never tried to make at home. In retrospect, choosing a dish with roughly fifteen steps and three separate components as my first pasta-making experience was perhaps overly ambitious, but I've always been the type to jump into the deep end.</p>

<p>Started around 2pm with the pasta dough. The recipe called for two cups of "00" flour, three eggs, a pinch of salt, and a tablespoon of olive oil. Simple enough ingredients, but the process of bringing them together was messier than I anticipated. I made a well in the flour on the counter (as instructed), cracked the eggs into it, and started incorporating the flour from the edges with a fork. Within about thirty seconds, the egg had breached the flour wall and was running across the counter and dripping onto the floor. Scrambled to contain it, got flour everywhere — on my shirt, in my hair, a smear across my forehead that I didn't discover until later. Eventually got the dough to come together into a shaggy mass and started kneading.</p>

<p>The kneading was actually therapeutic once I got past the initial stickiness. Eight to ten minutes of folding and pressing and turning. The dough transformed from a rough, lumpy blob into something smooth and elastic and alive-feeling under my hands. Wrapped it in plastic and let it rest for thirty minutes while I tackled the filling.</p>

<p>Roasting the butternut squash went smoothly — halved it, seeds out, cut side down on a baking sheet at 400 degrees for forty-five minutes. While it roasted, I grated Parmesan, minced garlic, and chopped sage. The kitchen smelled incredible. When the squash came out, the flesh was caramelized and soft, and I mashed it with ricotta, Parmesan, a grated nutmeg, salt, and pepper. Tasted it. Actually perfect — sweet and savory and rich.</p>

<p>Then came the rolling. I don't own a pasta machine, so I was doing this with a regular rolling pin, which I now understand is a form of upper-body exercise. Getting the dough thin enough was a genuine workout. My arms were burning after the first sheet. The recipe said to roll until you could "almost see your hand through it," and I'm going to be honest — I could not see my hand through it. I could see a vague hand-shaped shadow. Close enough. Cut the sheet into squares, spooned filling onto half of them, brushed the edges with water, and pressed the tops on, trying to seal without trapping air.</p>

<p>This is where things went wrong. My first batch of ravioli were overfilled — I was too generous with the squash mixture and they kept bursting open when I tried to seal them. The second batch I under-filled and they looked sad and deflated. By the third batch I'd found the sweet spot, but I only had enough dough for about eight more. So my final yield was roughly eight beautiful ravioli and about sixteen that ranged from "rustic" to "abstract art."</p>

<p>Dropped them into boiling salted water and held my breath. Several of the badly sealed ones immediately split open and donated their filling to the cooking water, which turned into a sort of squash soup. But the well-made ones held together beautifully, floating to the surface after about three minutes. Scooped them out carefully and placed them in the brown butter and sage sauce I'd prepared — butter melted until the milk solids turned golden and nutty, crispy sage leaves stirred in, finished with a squeeze of lemon.</p>

<p>The final dish was genuinely delicious. The pasta was tender with a slight chew, the filling was creamy and sweet, and the brown butter sauce tied everything together with that nutty, herbal richness. Sure, only about half my ravioli survived the cooking process, and the kitchen looked like a flour bomb had detonated, and I spent almost four hours making what amounted to a single serving of pasta. But I ate it slowly, savoring every bite, and felt an enormous sense of accomplishment. I made this. From flour and eggs and a squash. There's something deeply satisfying about transforming raw ingredients into something beautiful and nourishing with just your hands and some heat. I'm already planning my next attempt — maybe tortellini. How hard can it be?</p>`,

  // 5. Goals and self-improvement
  `<p>I've been doing a lot of thinking lately about the gap between who I am and who I want to be, and I'm trying to be honest with myself about what's actually holding me back versus what I just tell myself is holding me back. It's uncomfortable work, this kind of self-examination, but I think it's necessary. I'm thirty-four years old and I can feel the years starting to accelerate in that way people always warned me about, and I don't want to wake up at fifty having drifted into a life I didn't consciously choose.</p>

<p>The biggest pattern I notice is avoidance of discomfort. Not physical discomfort — I can handle a hard workout or a cold morning — but emotional and social discomfort. I avoid difficult conversations. I put off tasks that might reveal my incompetence. I scroll my phone instead of sitting with boredom or uncertainty. I choose the easy, familiar option over the challenging, growth-inducing one almost every time. And the frustrating thing is that I know this about myself, I've known it for years, and knowing it hasn't been sufficient to change it.</p>

<p>So I'm trying a different approach. Instead of making grand declarations about transformation — "I'm going to become a completely different person!" — I'm focusing on small, specific behavioral changes that I can track and measure. The idea comes from James Clear's atomic habits framework, which I've read about extensively but never actually implemented with any discipline. This time I'm being concrete about it.</p>

<p>Here are the five habits I'm building this quarter. First, I'm doing one thing each day that scares me slightly. This doesn't have to be dramatic — it can be as simple as speaking up in a meeting when I'd normally stay quiet, or sending an email I've been procrastinating on, or starting a conversation with a stranger. The point is to practice tolerating discomfort in small doses so it becomes less overwhelming. I've been tracking this in a simple spreadsheet and I'm on a twelve-day streak, which feels good.</p>

<p>Second, I'm implementing a strict "two-minute rule" for tasks I'm avoiding. If something will take less than two minutes, I do it immediately instead of adding it to a list where it will sit and generate anxiety. This has been surprisingly effective — most of the things I procrastinate on are actually tiny tasks that have grown enormous in my imagination. Third, I'm meditating for ten minutes every morning. Not because I expect enlightenment, but because the practice of sitting with my own thoughts without reaching for a distraction is exactly the muscle I need to strengthen.</p>

<p>Fourth, I'm reading for thirty minutes before bed instead of looking at screens. This serves double duty — it replaces a bad habit with a good one and it improves my sleep quality. I've noticed a genuine difference in how rested I feel in the morning since I started this three weeks ago. I'm currently reading "Man's Search for Meaning" by Viktor Frankl, which feels thematically appropriate for this whole project of intentional living.</p>

<p>Fifth, and this is the hardest one, I'm having one honest conversation per week. By "honest" I mean a conversation where I say something I would normally keep to myself — a feeling, a need, a boundary, a piece of feedback. Last week I told my manager that I feel underutilized in my current role and want more challenging assignments. The conversation was awkward and my heart was pounding the whole time, but she was receptive and we're meeting next week to discuss some options. It wouldn't have happened if I hadn't committed to this practice.</p>

<p>I know this all sounds very self-help-bookish, and part of me is embarrassed by how earnest it is. But I've spent years being too cool for self-improvement, too cynical to try sincerely, and where has that gotten me? I'm the same person I was at twenty-five, just older. The cynicism was never protecting me from anything — it was just a comfortable way to avoid the vulnerability of trying and potentially failing. So here I am, trying. Tracking my habits in a spreadsheet like some kind of productivity influencer. And you know what? It's working. Slowly, imperfectly, but it's working. I feel more awake than I have in years.</p>`,

  // 6. Fixing something around the house
  `<p>The bathroom faucet has been dripping for about three weeks now, and today I finally decided to fix it myself instead of calling a plumber. I've always been the type to call a professional for anything more complex than changing a lightbulb, but I'm trying to expand my competence in practical skills, and a dripping faucet seemed like a reasonable place to start. Famous last words, as it turned out.</p>

<p>I started by watching four different YouTube videos on how to fix a dripping single-handle faucet. Each video made it look absurdly simple — just pop off the handle cap, unscrew the handle, replace the cartridge, reassemble. "A ten-minute job," one guy said confidently. I took notes, feeling prepared and capable. Then I went to the hardware store and spent thirty minutes in the plumbing aisle trying to figure out which replacement cartridge I needed. The wall of nearly identical-looking cartridges was overwhelming. I ended up buying three different ones, figuring one of them had to be right.</p>

<p>Back home, I turned off the water supply valves under the sink. At least, I tried to. The cold water valve turned fine, but the hot water valve was frozen with age and corrosion. I tried pliers, WD-40, more pliers, and eventually resorted to wrapping a towel around it for grip and using both hands. It finally budged with a terrifying grinding sound that made me briefly wonder if I'd broken something important. But the water stopped, so I pressed on.</p>

<p>Removing the faucet handle was step one. The decorative cap that hides the screw was supposed to "pop off easily." It did not pop off easily. I tried a flathead screwdriver, which slipped and gouged the chrome finish. Tried a butter knife, which bent. Finally got it off with a combination of gentle prying and language that would make a sailor blush. Under the cap was a hex screw that required an Allen wrench. I own approximately forty Allen wrenches in a drawer, none of which were the right size. Trip number two to the hardware store.</p>

<p>With the correct Allen wrench, the screw came out smoothly, the handle lifted off, and I could see the cartridge. It was old and corroded, with visible mineral deposits — clearly the source of the drip. Pulling it out required a cartridge puller tool, which of course I didn't have. YouTube had suggested using pliers, so I grabbed my channel locks and yanked. The cartridge didn't move. I yanked harder. Still nothing. I braced my foot against the vanity cabinet for leverage and pulled with everything I had. The cartridge came out suddenly, I stumbled backward into the bathroom door, and a small geyser of water erupted from the faucet body.</p>

<p>Turns out the hot water valve hadn't fully closed. Water was spraying across the bathroom — onto the mirror, the towels, the toilet paper roll, my face. I scrambled under the sink, slipping on the wet floor, and cranked the valve until the spray stopped. Sat on the wet floor for a moment, breathing hard, surrounded by soggy towels and questioning my life choices.</p>

<p>But here's the thing: after mopping up the flood, I compared the old cartridge to my three purchases and — miracle — one of them was a match. I applied plumber's grease to the O-rings as instructed, slid the new cartridge in, reassembled the handle, turned the water back on, and... no drip. Not a single drop. The handle moved smoothly, the water flow was even, and the silence where the drip had been was deeply satisfying.</p>

<p>The whole project took about two and a half hours, involved two trips to the hardware store, one minor flood, several scrapes on my knuckles, and a significant expansion of my vocabulary. A plumber would have done it in fifteen minutes for eighty dollars. But I did it myself, I learned something, and every time I use that faucet now I feel a small surge of pride. Next project: the running toilet in the guest bathroom. I'll buy the cartridge puller tool first this time.</p>`,

  // 7. Learning a new skill
  `<p>I started learning to play the piano three months ago, at the age of thirty-two, with absolutely zero musical background. No childhood lessons, no natural talent, can't read sheet music, can barely clap in rhythm. My friends thought I was joking when I told them. My girlfriend gently suggested that maybe I should start with something simpler, like the ukulele. But I've always loved the sound of a piano, and I found a reasonably priced digital keyboard on sale, and I figured: why not? The worst that can happen is I'm terrible at it, and I'm already terrible at it, so there's nowhere to go but up.</p>

<p>The first two weeks were humbling in a way I wasn't prepared for. I'm used to being competent at things. At work, I know what I'm doing. I can troubleshoot complex systems, manage difficult conversations, make decisions under pressure. Sitting at a keyboard and fumbling through "Mary Had a Little Lamb" with one hand while my other hand lay uselessly in my lap was a profound ego adjustment. My fingers didn't go where I told them to. My pinky seemed to have its own agenda. The disconnect between what I heard in my head and what came out of the keyboard was almost comically large.</p>

<p>I'm using a combination of a YouTube channel called "Piano In 21 Days" (misleading title — it's been 90 days and I cannot play the piano) and a book called "Alfred's Basic Adult Piano Course," which is designed for exactly my situation: adult beginners who are starting from absolute zero. The book is great because it introduces concepts in a logical sequence and has you playing simple songs almost immediately, which is motivating even when the songs are painfully basic.</p>

<p>The breakthrough came around week four when I started being able to play with both hands simultaneously. Not well, mind you — the coordination required to have each hand doing something different is genuinely one of the strangest physical challenges I've encountered. It's like trying to pat your head and rub your stomach, except both motions are constantly changing and you need to keep them in time with each other. But one evening I was practicing a simple arrangement of "Ode to Joy" and both hands came together for about eight bars, and for those few seconds, I was making music. Real music, with harmony and melody. I actually got a little emotional about it.</p>

<p>I've been practicing about thirty minutes a day, which I've learned is actually more effective than longer sessions for beginners. The brain needs time to consolidate the neural pathways between practice sessions. I practice scales for five minutes (boring but essential — my fingers are finally starting to move independently), then work on whatever piece I'm currently learning, then spend the last five minutes just playing around, improvising, seeing what sounds good. That last part is my favorite because it feels the most like actually making music rather than doing exercises.</p>

<p>Currently I'm working on a simplified version of Debussy's "Clair de Lune," which is wildly above my skill level but I don't care. I can play the first sixteen bars at about half speed with moderate accuracy. The left hand part has these beautiful rolling arpeggios that I can execute individually but struggle to play smoothly in sequence. My teacher (I started taking lessons last month — best decision I've made) says I need to practice each hand separately until the motions are automatic before trying to combine them. She's patient and encouraging and only occasionally winces at my timing.</p>

<p>What surprises me most about this whole experience is how much it's changed the way I listen to music. I hear things now that I never noticed before — the way a chord progression creates tension and resolution, the way dynamics shape the emotional arc of a piece, the incredible coordination required for even a seemingly simple performance. I went to a jazz club last weekend and watched the pianist with new eyes, his hands moving with a fluency and expressiveness that felt almost superhuman. I don't know if I'll ever play like that. Probably not. But the journey itself — the daily practice, the incremental improvements, the small victories — has become one of the most rewarding parts of my life. I wish I'd started twenty years ago, but I'm glad I started now.</p>`,

  // 8. Rainy day reading and thinking
  `<p>It's been raining since before I woke up — that steady, soaking, all-day kind of rain that makes everything outside look grey and blurred, like the world is behind frosted glass. The kind of rain that gives you permission to stay inside and be still. I made coffee, put on a wool sweater, and settled into the armchair by the window with a stack of books and no agenda for the day. These are the days I secretly love the most, the ones where the weather makes the decision for you: stay in, slow down, think.</p>

<p>Started with the book I've been reading, "Gilead" by Marilynne Robinson. It's a quiet novel — an aging minister writing a letter to his young son, trying to pass along the wisdom and wonder he's accumulated over a lifetime. The prose is so beautiful it keeps stopping me. I'll read a sentence and have to sit with it for a moment, turning it over in my mind. She writes about ordinary things — light, water, bread, the feeling of wind — with such attention and reverence that you start seeing your own ordinary life differently. There's a passage about the way light falls on a child's hair that made me set the book down and just look out the window at the rain for a while.</p>

<p>Around midmorning I switched to a collection of essays by Ursula Le Guin that I've been meaning to read. She writes about writing, creativity, and the responsibilities of imagination with a clarity and conviction that's almost bracing. One essay about the commodification of literature really resonated — she argues that treating books as "content" to be "consumed" fundamentally misunderstands what reading is. Reading is not consumption, she says; it's an act of co-creation between the writer and the reader, a collaborative imagining. Every reader brings something different to the text, and the book that exists in your mind is not the same book that exists in mine. I like that idea enormously.</p>

<p>Made lunch — just soup from a can and some crackers, nothing elaborate — and sat at the kitchen table listening to the rain on the roof. There's a specific quality to the sound of rain on an old house that I find deeply comforting. Something about being warm and dry while the world is wet, some ancient, animal satisfaction in shelter. I thought about how many human beings over how many thousands of years have sat in their shelters listening to rain and feeling this same particular contentment. It connects you to something bigger than yourself.</p>

<p>In the afternoon I drifted into a philosophical mood. Started thinking about attention — how it's become the scarcest resource in modern life, how we fragment it across dozens of inputs and stimuli, how rare it is to give any single thing our full, undivided focus. Days like today, when the rain eliminates distractions and options, are valuable precisely because they restore something in the attention span. I've been reading for hours and my mind feels sharp and expansive, not scattered and depleted the way it usually does by this time of day.</p>

<p>This led me to thinking about solitude and why I need more of it than I usually allow myself. I like people, I enjoy socializing, but I also need regular periods of being alone with my own thoughts to process and integrate my experiences. Without that processing time, life starts to feel like a conveyor belt — experiences come at me one after another, but none of them fully land. They don't become memories or insights; they just become a blur. Today's stillness is letting the last few weeks actually settle into something coherent.</p>

<p>As evening came on I lit a candle and started re-reading some journal entries from the past year. It's interesting how different my handwriting looks when I'm stressed versus calm. The stressed entries are tight and cramped, the calm ones are more open and looping. A whole emotional barometer encoded in penmanship. I'm grateful for this journal practice, this ongoing conversation with myself. It gives shape and meaning to days that might otherwise slip by unexamined. And on rainy days like this one, it gives me something worth reading while the world outside dissolves into grey.</p>`,

  // 9. Social gathering / party
  `<p>Went to Marco and Elena's housewarming party last night and it turned into one of those unexpectedly wonderful evenings that reminds you why you should always say yes to social invitations even when you'd rather stay on the couch. I almost didn't go — it had been a long week at work, I was tired, and the thought of making small talk with strangers had zero appeal. But I'd RSVPed and didn't want to be that person who cancels last minute, so I put on a decent shirt, grabbed a bottle of wine, and drove over.</p>

<p>Their new place is a 1920s bungalow in the old part of town that they've been renovating for months. The transformation is impressive — they knocked out a wall between the kitchen and dining room to create this open, airy space, refinished the original hardwood floors, and painted everything in these warm, earthy tones. Elena has an incredible eye for design. There were interesting objects everywhere: vintage botanical prints, pottery from their trip to Oaxaca, a collection of old globes on a shelf. The kind of home that has stories embedded in every corner.</p>

<p>The party was bigger than I expected — maybe forty people spread between the house and the backyard. Marco had strung lights in the trees and set up a bar on an old door balanced on sawhorses, which somehow looked chic rather than makeshift. The music was excellent — a playlist that moved seamlessly from Chet Baker to Khruangbin to Fela Kuti, curated with obvious care. Good music at a party is one of those things people underestimate; it sets the whole tone.</p>

<p>I knew maybe a third of the people there, which is that sweet spot where you have familiar faces to anchor you but also plenty of opportunity for new connections. Got into a fantastic conversation with a woman named Priya who works in documentary filmmaking. She'd just finished a project about community gardens in post-industrial cities and the way she talked about it — with this combination of passion and precision — was genuinely captivating. We ended up talking for almost an hour about storytelling, gentrification, the tension between documenting communities and commodifying them. The kind of conversation you can only really have at a party, with a drink in your hand and no agenda.</p>

<p>Later in the evening, someone brought out a guitar and a few people started singing. This is the kind of thing that normally makes me cringe — forced group participation in musical activities — but it was organic and unpretentious. Just a handful of people who could play gathered in a corner, doing old folk songs and Beatles tunes. I sat on the periphery with my wine and enjoyed being a spectator. There's a particular warmth that live, imperfect music brings to a room that recorded music can't replicate. Something about the vulnerability of performing in front of friends, the little mistakes and laughter, the way people join in on the choruses they know.</p>

<p>Around midnight I found myself sitting on the back porch steps with Marco and two of his neighbors, talking about nothing important — best taco places in the city, whether vinyl actually sounds better than digital (consensus: no, but the ritual matters), someone's theory about why old houses have better energy than new ones. The air was cool, the stars were out, and I felt that particular late-night-party contentment where you're slightly tired and slightly buzzed and surrounded by good energy. Marco was radiantly happy about the house, about Elena, about the life they're building here. It was infectious.</p>

<p>Drove home around 1am, windows down, replaying conversations in my head. I'm so glad I went. The couch would have been comfortable, the Netflix would have been fine, and I would have woken up Sunday morning having had a perfectly adequate Friday night. Instead I have new ideas rattling around in my head, a documentary filmmaker's email in my phone, and the warm afterglow of genuine human connection. I need to remember this feeling the next time I'm tempted to cancel plans because I'm tired. Fatigue is temporary; experiences are permanent.</p>`,

  // 10. Workout/exercise log with thoughts
  `<p>Six-thirty AM, gym is nearly empty, which is exactly why I come this early. There's something about the pre-dawn gym that appeals to me — the serious regulars quietly doing their work, the hum of the overhead lights, the satisfying clank of plates in an otherwise silent building. No waiting for equipment, no one trying to talk to me between sets, just focused effort. Started with a ten-minute warm-up on the rowing machine, keeping the pace easy, feeling my body wake up one muscle group at a time. My lower back was stiff from sitting at a desk all week, and it took a few minutes before it loosened up enough to move freely.</p>

<p>Today was squat day, which is simultaneously my favorite and most dreaded workout. Favorite because squats are the most effective exercise I do — nothing else makes me feel as strong or as accomplished when I'm done. Dreaded because heavy squats are genuinely hard in a way that no other exercise matches. They require full-body engagement, mental focus, and a willingness to sit under heavy weight at the bottom of the movement where you feel most vulnerable. Working sets today were four sets of five at 245 pounds, which is about 85% of my one-rep max.</p>

<p>The first set felt heavy. It always does. The bar settles onto my traps, I take a breath, brace my core, and unrack. Walk it back, set my feet, another breath. Down into the hole — the hardest part is the moment at the bottom where you're deep in the squat and you have to reverse direction, driving up through your heels while keeping your chest up and your core tight. That moment is where doubt lives. Can I get this up? What if I fail? But my body knows the movement by now, thousands of reps over the years, and muscle memory takes over. The bar rises. One rep. Four more. Each one is its own small battle between gravity and willpower.</p>

<p>Between squat sets I rest for three minutes and stare at the wall. No phone, no music, just breathing and mental preparation for the next set. I've found that this inter-set meditation — if you can call it that — is actually one of the most valuable parts of my workout. Three minutes of doing nothing but existing in my body, feeling my heartbeat slow, noticing the sweat on my forehead, the grip of my shoes on the platform. It's the most present I feel all day. Sets two and three went better than the first — the nervous system wakes up, the movement pattern clicks in, and the weight feels lighter even though it's the same load. Set four was a grind. Rep four was ugly. Rep five was a fight. But I got them all.</p>

<p>After squats, I moved to Romanian deadlifts — three sets of eight at 185. These target the hamstrings and lower back, and they're an important complement to squats. The key is the hip hinge — pushing your hips back while keeping the bar close to your legs, feeling the stretch in your hamstrings, then driving your hips forward to stand up. It's a deceptively technical movement. When I first started doing them, my lower back would take over and I'd be sore for days in all the wrong places. Now, three years later, I can feel my hamstrings loading through the entire range of motion, and the movement feels smooth and controlled.</p>

<p>Finished with Bulgarian split squats, which are basically single-leg squats with your rear foot elevated on a bench. These are humbling because the balance component exposes every asymmetry and weakness. My left leg is noticeably weaker than my right, and by the third set it was shaking visibly. Three sets of ten each leg with a thirty-five-pound dumbbell in each hand. Simple, brutal, effective. Also did some calf raises and core work — hanging leg raises and Pallof presses — before calling it a morning.</p>

<p>Total time in the gym: about seventy-five minutes. Walked out into the sunrise feeling like a different person than the stiff, groggy version who'd shuffled in an hour earlier. This is the secret of morning exercise that's hard to convey to non-believers: it's not really about fitness or aesthetics or health, though those are nice side effects. It's about starting the day having already done something hard. By 7:45 AM I've already confronted discomfort, pushed through resistance, and accomplished something tangible. Everything else the day throws at me feels more manageable by comparison. Ate breakfast — four eggs, oatmeal with banana and peanut butter — and headed to work feeling genuinely good. Leg day soreness will arrive tomorrow. It always does. And I'll welcome it like an old friend.</p>`,

  // 11. Difficult conversation
  `<p>Had the conversation with Jake today. The one I've been putting off for almost a month. We've been friends since college — fifteen years — and for most of that time it's been one of the easiest, most natural friendships in my life. But something has been off for the past six months, and I finally forced myself to address it directly instead of continuing to pretend everything was fine while resentment quietly built up inside me.</p>

<p>The issue, at its core, is reciprocity. Or rather, the lack of it. For the past year or so, I've been the one initiating every plan, every text conversation, every check-in. When we do hang out, he's often distracted — looking at his phone, canceling plans last minute, or showing up late without apology. When I went through a rough patch at work earlier this year, he was barely present. I texted him one night feeling genuinely low and he responded three days later with "sorry man, been busy." Meanwhile, when he had a crisis with his relationship in September, I cleared my schedule, drove to his apartment, and stayed until 2 AM listening and being supportive. The asymmetry had become impossible to ignore.</p>

<p>We met for coffee this afternoon. I'd been rehearsing what I wanted to say all morning, which probably wasn't healthy, but I needed some structure to lean on because this kind of direct emotional communication doesn't come naturally to me. I started by telling him that our friendship is important to me and that I was bringing this up because I wanted to strengthen it, not damage it. Then I described the pattern I'd been noticing, trying to stick to specific examples rather than sweeping accusations.</p>

<p>His initial reaction was defensive, which I expected. "I've been really busy with work," he said. "You know how things have been." And I do know — his job has been demanding. But I pushed back gently and pointed out that being busy is a choice about priorities, and the message I've been receiving is that our friendship isn't one of his. That landed. I could see it register on his face, that moment when defensiveness cracks and something more vulnerable shows through.</p>

<p>What followed was the most honest conversation we've probably ever had. He admitted that he's been pulling away from most of his friendships, not just ours. He's been in a depressive episode that he hasn't told anyone about, and his coping mechanism has been isolation. He said he knows he's been a bad friend but the thought of reaching out when he's feeling low feels impossibly heavy. "It's not that I don't care," he said. "It's that I don't have the energy to show it." That hit me hard. My resentment immediately complicated itself with guilt and compassion. Here I was feeling sorry for myself about unreturned texts while he was quietly struggling.</p>

<p>We talked about what we both need going forward. I told him I can handle imperfect communication — a short text, even just an emoji, just something that says "I'm here, I'm thinking of you, I haven't forgotten." He said he'd try, and he also said he's considering talking to a therapist, which I strongly encouraged. I offered to help him find one if that would lower the barrier, and he seemed genuinely relieved by the offer. We also acknowledged that the friendship might look different now than it did in college, and that's okay. People change, life circumstances change, and friendships that survive are the ones that can adapt.</p>

<p>Walking home afterward, I felt this strange cocktail of emotions. Relief that the conversation had happened and gone better than my worst-case scenarios. Sadness for what Jake is going through. Gratitude that fifteen years of friendship had built enough trust to hold a conversation like that. And a certain pride in myself for not doing what I usually do, which is swallow my feelings and let them curdle into passive-aggressive distance. I said the hard thing. I was vulnerable and direct and it didn't kill me. In fact, it brought us closer.</p>

<p>I think a lot of friendships quietly die because nobody has the courage to say "something is wrong." We just drift apart, telling ourselves it's natural, it's what happens, people grow in different directions. And sometimes that's true. But sometimes the friendship is worth fighting for, and fighting for it means having the uncomfortable conversation instead of taking the easy exit. Today was a good reminder of that. I hope Jake calls the therapist. I'm going to check in with him this weekend, and this time I won't mind being the one to reach out first.</p>`,

  // 12. Movie/book review with reflections
  `<p>Finished reading "The Remains of the Day" by Kazuo Ishiguro last night, and I've been thinking about it all day. I can't remember the last time a novel stayed with me this insistently, rattling around in my mind during meetings, intruding on my concentration, making me stop mid-task to consider some implication I hadn't fully processed. It's one of those books that seems simple on the surface — a butler takes a short road trip through the English countryside — but contains such depths of meaning and emotion that I know I'll be unpacking it for weeks.</p>

<p>The novel is narrated by Stevens, the butler of a great English house, who has spent his entire life in service, perfecting the art of being useful, proper, and invisible. He's an unreliable narrator in the most heartbreaking way — not because he's lying to the reader, but because he's lying to himself. Throughout the book, he recounts his life and career with an air of professional satisfaction, but the gaps in his story — the things he doesn't say, the emotions he doesn't acknowledge, the moments he glosses over — tell a completely different story. It's a masterclass in subtext.</p>

<p>The central relationship in the book, between Stevens and the housekeeper Miss Kenton, is devastating precisely because nothing ever happens. They work alongside each other for years, and there are moments — small, charged, exquisitely written moments — where something more is clearly possible. A look that lingers too long, a conversation that drifts toward the personal, a doorway moment where one of them could speak and doesn't. Miss Kenton, it becomes clear, is waiting for Stevens to acknowledge what's between them. And Stevens, imprisoned by his conception of duty and professionalism, never does. He can't even admit to himself that there's anything to acknowledge.</p>

<p>What makes this so painful is that Stevens isn't a cold person. Ishiguro writes him with such precision that you can feel the emotions churning beneath the professional surface. There's a scene where Miss Kenton tells him she's received a marriage proposal from another man, and Stevens responds with perfect composure, congratulating her, saying he's sure it will be a fine match. But the narration after that moment — the way Stevens describes returning to his pantry, sitting alone, checking his inventory of silver polish — is so suffused with unspoken grief that I had to put the book down and just sit with it for a while.</p>

<p>The book has made me think about my own emotional armor. I'm not a butler in a grand English house, obviously, but I recognize something of Stevens in myself — the tendency to prioritize composure over authenticity, to retreat into duty and professionalism when emotions get uncomfortable, to mistake restraint for strength. How many moments in my own life have I let pass because I was too controlled, too careful, too afraid of looking foolish to say what I actually felt? The answer, I suspect, is more than I'd like to admit.</p>

<p>Ishiguro's prose style is perfect for this story — restrained, precise, almost clinical, mirroring Stevens' own temperament. But every so often a sentence will appear that's so quietly devastating it takes your breath away. Near the end of the book, Stevens is sitting on a pier at sunset, and he finally allows himself a moment of honest reflection. "I can't even say I made my own mistakes," he says. "Really — one has to ask oneself — what dignity is there in that?" It's the first time in the entire novel that his mask truly slips, and after three hundred pages of watching him maintain it, the effect is shattering.</p>

<p>I've also been thinking about the book's other major theme, which is the danger of placing your faith in a larger cause or authority figure without exercising your own moral judgment. Stevens devoted his life to serving Lord Darlington, who turned out to be a Nazi sympathizer. Stevens knew this on some level but chose not to examine it, because examining it would mean questioning the entire framework of loyalty and service that gave his life meaning. It's a powerful cautionary tale about the cost of outsourcing your moral compass. I think about how applicable this is to modern life — how easy it is to serve a company, a party, a platform without asking whether what we're serving actually deserves our devotion.</p>

<p>Anyway. Five stars. Going to read it again in a year or two, and I suspect I'll find entirely different things in it the second time around. That's the mark of a truly great novel — it grows as you grow. Right now I'm going to sit with the feeling it's given me and try not to distract myself out of it. Some books shouldn't be followed immediately by the next book on the list. They should be given room to breathe.</p>`,

  // 13. Planning an upcoming event
  `<p>Mom's 65th birthday is in three weeks and I'm organizing a surprise party, which is turning out to be a significantly more complex logistical operation than I anticipated. It's not the party itself that's complicated — it's keeping it secret from a woman who has an uncanny sixth sense for when people are hiding things from her. She once figured out her own Christmas present because she noticed Dad had been to the mall twice in one week, which she correctly deduced was suspicious behavior for a man who normally avoids retail environments like they're radioactive. So the secrecy operation here needs to be airtight.</p>

<p>The venue is sorted — we're doing it at the community center by the lake, which has a big event room with floor-to-ceiling windows overlooking the water. I booked it two weeks ago under the pretense of "checking out spaces for a work event." The rental includes tables and chairs for up to sixty people, a small kitchen for food prep, and access to the lakeside patio. The view at sunset is gorgeous, and since the party starts at 5pm, we should hit that golden hour window right around dessert time.</p>

<p>The guest list is currently at forty-seven people, which is larger than I'd planned but Mom has a lot of friends and I couldn't figure out how to trim it without someone feeling excluded. The list includes: immediate family (eight people, including the kids), her book club (six women who have been meeting monthly for twenty years), neighbors from both the old house and the current one (twelve), her former colleagues from the library (seven), college friends who are flying in from out of state (four), and assorted other friends and their partners. I've been sending invitations through a private email chain that specifically instructs everyone to NOT post anything on social media, which I've had to emphasize three separate times because Aunt Linda almost blew the whole thing with a "can't wait for the big day!!" Facebook post that she fortunately deleted before Mom saw it.</p>

<p>Food is the area where I'm most anxious. I want it to be special but not so elaborate that the preparation becomes a nightmare. The plan is a Mediterranean-themed spread because Mom loves that cuisine: hummus and baba ganoush with pita, a big Greek salad, grilled chicken skewers with tzatziki, a pasta salad with feta and sundried tomatoes, and roasted vegetable platters. I'm ordering the hummus and baba ganoush from that Lebanese restaurant she loves (they do catering), making the chicken skewers and pasta salad myself (tested both recipes last weekend — the pasta salad needs more lemon), and enlisting my sister to handle the Greek salad and vegetable platters the morning of.</p>

<p>The cake is being handled by my brother, who is secretly a much better baker than anyone in the family gives him credit for. He's making a three-layer lemon cake with raspberry filling and cream cheese frosting, which is Mom's absolute favorite. He's been practicing the recipe and reports that his third attempt was "restaurant quality," which from him is not an exaggeration. We're decorating it with fresh flowers — edible ones — from the farmers market.</p>

<p>Entertainment: I've asked Mom's book club friend Patricia to put together a slideshow of photos spanning Mom's life — childhood, college, wedding, us as kids, recent years. Patricia is a retired graphic designer so this is in excellent hands. I've been secretly collecting photos from family members for the past month, scanning old albums when Mom wasn't home. The collection is pretty comprehensive, about eighty photos, including some gems I'd never seen before — Mom in her twenties looking impossibly cool in a leather jacket, Mom holding me as a newborn looking exhausted but radiant, Mom at her library desk surrounded by piles of books and smiling at the camera.</p>

<p>The cover story for getting Mom to the venue is that we're going to a "family dinner" at a restaurant near the lake. My brother will drive her, and on the way will suggest "stopping by the community center to check something." It's a thin premise but we only need it to hold for about thirty seconds. The plan is for everyone to be in position by 4:45, lights dimmed, and when she walks in — surprise. My brother has been instructed to have tissues in his pocket because Mom is a crier, and honestly, I might need some too.</p>

<p>Remaining to-do list: finalize the catering order by Wednesday, buy decorations (streamers, balloons, tablecloths — her favorite color is deep purple), create a playlist of her favorite music for the background (lots of Fleetwood Mac and Joni Mitchell), coordinate the flower arrangement for the cake, buy a card and organize a group gift (we're pooling for a weekend trip to that vineyard she's been talking about), and do a final headcount. Three weeks feels like plenty of time but I know from experience that it will evaporate fast. I want this to be perfect. She deserves it.</p>`,

  // 14. Nostalgic childhood memories
  `<p>I drove past my childhood house today. Wasn't planning to — I was on my way to a meeting on the other side of town and took a wrong turn that happened to route me down Maple Street, and there it was. The pale yellow two-story with the wraparound porch and the big oak tree in the front yard. Someone has painted the shutters a different color — they're navy blue now instead of the forest green I remember — and there's a new fence around the backyard. But the bones of the place are exactly the same, and seeing it triggered such a flood of memory that I had to pull over and sit in my car for a few minutes.</p>

<p>We moved into that house when I was six, which means I spent twelve years there — from first grade through the end of high school. Twelve years in one house is an eternity when you're a kid. Every corner of that place is mapped in my memory with an almost physical precision. I know exactly which stair creaks (the fourth one from the top), which window sticks (the one in the upstairs bathroom), and which section of the kitchen floor slopes slightly toward the back door (the original foundation settled unevenly, Dad used to say, which gave the house character). I could walk through that house blindfolded and not bump into a single thing.</p>

<p>The oak tree in front is massive now — much bigger than I remember, which of course it would be after twenty years. When I was a kid, it had a rope swing that my father hung from one of the lower branches. The branch was probably fifteen feet up, and the rope was thick and rough and had a wooden disc at the bottom for a seat. I spent hundreds of hours on that swing. In summer I'd pump my legs and arc so high that I could see over the neighbor's roof, and there was always that thrilling moment at the top of the arc where I was weightless for a fraction of a second before gravity pulled me back. The rope eventually frayed and broke when I was about twelve, and I was actually heartbroken. Dad said we'd put up a new one but we never did.</p>

<p>The backyard was where most of my childhood happened. It was big — big enough for a decent game of whiffle ball, which we played almost every summer evening with the neighborhood kids. The bases were a garden rock, a frisbee, and a bare patch of dirt where the grass had worn away from too many sneakers pivoting. The property ended at a creek that was barely a trickle in summer but swelled to something genuinely impressive after heavy rain. We built dams in that creek, caught crawfish with our bare hands, and once found a painted turtle that we kept in a bucket for exactly two hours before my mother made us release it.</p>

<p>Inside, the house had that particular smell that all childhood homes have — a combination of whatever was being cooked, the laundry detergent your family used, the wood of the floors, and something else entirely, something unnameable that was just the smell of your life. I can still conjure it if I close my eyes and concentrate. My room was at the top of the stairs on the left, the smallest bedroom, with a window that looked out over the backyard. The walls were covered with magazine cutouts, band posters, and a map of the world that I used to stare at before falling asleep, imagining all the places I'd go someday.</p>

<p>I spent a lot of time in the basement, which was semi-finished — Dad had put in carpet and paneling but it still had that underground coolness and faint mustiness of a basement. That's where the TV was, and the Nintendo, and the couch with the broken spring that you had to navigate around. My best friend Marcus and I logged ungodly hours on that couch playing video games, eating pizza rolls, and having the kind of sprawling, unstructured conversations that only happen when you're thirteen and have no sense of time. We'd talk about everything — which superpower would you choose, what do you think happens after you die, if you could live in any time period which would it be. I don't know if I've ever had conversations that felt as purely speculative and free since then.</p>

<p>The kitchen was Mom's domain. She wasn't a fancy cook but she was consistent and comforting — meatloaf on Mondays, pasta on Wednesdays, homemade pizza on Fridays. The kitchen table is where homework happened, where arguments were resolved, where important news was delivered. I found out my grandmother died sitting at that table. I learned I'd been accepted to college sitting at that table. It was the center of the house in every sense.</p>

<p>Sitting in my car looking at the yellow house with the new blue shutters, I felt that particular ache of nostalgia that isn't quite sadness but isn't quite happiness either. It's more like a recognition of time passing, a visceral awareness that the person who lived in that house — that six-year-old, that twelve-year-old, that eighteen-year-old leaving for college with everything he owned in the back of a Honda Civic — exists now only in memory. The house goes on. The oak tree keeps growing. But the life I lived there is finished, and sitting in its afterglow is bittersweet in the truest sense of that word. I put the car in drive and headed to my meeting, carrying the past with me the way you always do — invisibly, permanently.</p>`,

  // 15. Helping a friend move
  `<p>Spent all of Saturday helping Dave move out of his third-floor apartment, and I can now confirm that the phrase "it'll just take a few hours" when spoken by someone about to move is one of the great lies of human civilization, right up there with "I'll start the diet on Monday" and "I'm five minutes away." We started at 8am and I didn't get home until after 7pm, and my body feels like it's been through a car wash designed for humans. Everything hurts. Muscles I didn't know I had are filing formal complaints.</p>

<p>The first problem was that Dave had not, despite promising repeatedly, finished packing before moving day. When I arrived at 8am, he was standing in his kitchen surrounded by open cabinets full of dishes and utensils, holding a roll of bubble wrap with the expression of a man confronting the true scope of a task he'd been avoiding. "I just have a few things left to box up," he said, gesturing at what appeared to be an entire, undiminished kitchen's worth of stuff. So the first two hours were spent packing while Dave narrated which items had sentimental value (apparently everything, including a novelty shot glass from a casino in Reno).</p>

<p>The moving truck was a fourteen-footer that Dave had rented from one of those budget truck companies. It arrived with a fuel gauge just above empty, a mysterious stain on the seat, and a ramp that had to be coaxed down with the kind of percussive maintenance that involves hitting things with your palm while swearing. But it ran, and the cargo area was clean enough, so we started loading.</p>

<p>Loading a moving truck is a spatial reasoning puzzle that becomes increasingly impossible as the day goes on and your decision-making abilities degrade along with your physical stamina. The first load went beautifully — couch against the wall, mattress standing up, boxes stacked neatly, dresser wedged in perfectly. It looked like a game of Tetris played by a professional. By the fourth trip up and down three flights of stairs, we were just hurling things into the truck with the organizational philosophy of "it fits where it fits." Dave's bookshelf went in at an angle that defied geometry. A floor lamp was somehow both horizontal and diagonal simultaneously.</p>

<p>The bookshelf, by the way, nearly killed us. Dave is a serious reader and owns approximately four hundred books, which he had packed into medium-sized boxes that each weighed roughly the same as a small refrigerator. Carrying those boxes down three flights of narrow, turning stairs was a special kind of torture. My grip strength gave out around box number twelve, and I had to switch to carrying them against my chest like a very heavy, very rectangular baby. My forearms are going to be useless for days.</p>

<p>Around 1pm we took a break for pizza, which we ate sitting on the bare floor of Dave's empty living room. There's something melancholy about an emptied-out apartment — the walls are suddenly visible, dotted with nail holes and slightly discolored rectangles where pictures hung. The rooms feel bigger and smaller at the same time. Dave got a little nostalgic. He lived in this apartment for four years, which is the longest he's stayed anywhere since college. His first apartment after his divorce, the place where he rebuilt his life. He didn't say all of that explicitly, but it was there in the way he looked at the empty rooms, the slight pause before he closed the front door for the last time.</p>

<p>Unloading at the new place was somehow worse than loading, because the new apartment is on the second floor with a narrower stairway and a turn at the landing that required us to tilt the couch at a near-vertical angle to get it around. There's a gouge in the wall at the landing that we decided to jointly deny any knowledge of. The dresser didn't fit through the bedroom door and had to have its drawers removed, be tipped on its side, and maneuvered through at an angle that required one of us to stand inside the bedroom pulling while the other pushed from the hallway. At one point we were both laughing so hard we had to set it down and rest.</p>

<p>By 6pm the truck was empty, the furniture was approximately in place, and we were both destroyed. Dave ordered Thai food and we ate it sitting on his couch in his new living room, surrounded by an ocean of boxes, too tired to even find the remote for the TV. He thanked me several times, sincerely, and said he'd return the favor anytime I needed to move. I told him I'm never moving again. I'm going to die in my current apartment and they can carry me out in one box. A light one.</p>

<p>But honestly, despite the exhaustion and the sore muscles and the eleven hours of manual labor, it was a good day. There's something bonding about shared physical hardship. Dave and I have been friends for a decade, but I feel like helping someone move — really move, not just showing up for the easy part — deepens a friendship in a way that socializing doesn't. You see each other at your most frustrated, most tired, most vulnerable. You problem-solve together. You laugh at the absurdity of trying to fit a king-sized mattress around a ninety-degree turn. You earn the pizza and the Thai food and the cold beer at the end. I'm going to feel this in my body for a week, but it was worth it. That's what friends are for.</p>`
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('Connecting to Supabase...');

  // 1. Get user_id
  const { data: existingBlocks, error: blocksErr } = await supabase
    .from('journal_blocks')
    .select('user_id')
    .limit(1);

  if (blocksErr || !existingBlocks || existingBlocks.length === 0) {
    console.error('No journal blocks found:', blocksErr);
    process.exit(1);
  }
  const userId = existingBlocks[0].user_id;
  console.log(`Using user_id: ${userId}`);

  // 2. Get workspaces
  const { data: workspaces, error: wsErr } = await supabase
    .from('workspaces')
    .select('id, name')
    .eq('user_id', userId)
    .limit(3);

  if (wsErr || !workspaces || workspaces.length === 0) {
    console.error('No workspaces found:', wsErr);
    process.exit(1);
  }
  console.log(`Found ${workspaces.length} workspaces: ${workspaces.map(w => w.name).join(', ')}`);

  // 3. Shuffle the 15 long entries and assign 5 per workspace
  const shuffled = shuffleArray(LONG_ENTRIES);
  let entryIdx = 0;
  let totalUpdated = 0;

  for (const ws of workspaces) {
    console.log(`\nProcessing workspace: ${ws.name}`);

    // Get shorter entries from this workspace (content length < 500 chars = likely seed data)
    const { data: entries, error: fetchErr } = await supabase
      .from('journal_blocks')
      .select('id, content')
      .eq('workspace_id', ws.id)
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    if (fetchErr) {
      console.error(`  Error fetching entries for workspace ${ws.name}:`, fetchErr);
      continue;
    }

    // Filter to shorter entries (seed data is typically under 600 chars)
    const shortEntries = entries.filter(e => e.content && e.content.length < 600);
    console.log(`  Found ${shortEntries.length} short entries (of ${entries.length} total active)`);

    if (shortEntries.length === 0) {
      console.log(`  No short entries to extend, skipping.`);
      continue;
    }

    // Pick 5 random ones
    const picked = shuffleArray(shortEntries).slice(0, 5);
    console.log(`  Picked ${picked.length} entries to extend.`);

    for (const entry of picked) {
      const newContent = shuffled[entryIdx % shuffled.length];
      entryIdx++;

      // Extract plain text from the HTML for the content field
      const plainText = newContent.replace(/<\/?p>/g, ' ').replace(/\s+/g, ' ').trim();

      const { error: updateErr } = await supabase
        .from('journal_blocks')
        .update({
          content: plainText,
          content_html: newContent,
        })
        .eq('id', entry.id);

      if (updateErr) {
        console.error(`  Error updating entry ${entry.id}:`, updateErr);
      } else {
        const wordCount = plainText.split(/\s+/).length;
        console.log(`  Updated entry ${entry.id} (${wordCount} words)`);
        totalUpdated++;
      }
    }
  }

  console.log(`\nDone! Updated ${totalUpdated} entries with extended content.`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
