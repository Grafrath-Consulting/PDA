ALTER TABLE journal_blocks DISABLE TRIGGER on_block_updated;
UPDATE journal_blocks SET updated_at = '2026-03-21T13:41:28.644441+00:00'::timestamptz WHERE id = 'd6674724-28f8-42ba-ad6c-15fdbaf75ff1';
UPDATE journal_blocks SET updated_at = '2026-03-21T18:39:41.070224+00:00'::timestamptz WHERE id = '6b7d8eca-a8c2-487d-b988-675a95e5823a';
UPDATE journal_blocks SET updated_at = '2026-03-21T18:40:14.060994+00:00'::timestamptz WHERE id = 'bb6a4342-b68a-4aea-99f7-3182d6099ebf';
ALTER TABLE journal_blocks ENABLE TRIGGER on_block_updated;
