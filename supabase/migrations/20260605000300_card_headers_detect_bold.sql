-- The earlier header backfills used \b for a word boundary, but in Postgres
-- regular expressions \b is a backspace character (word boundary is \y). So they
-- matched nothing and set every card's header_enabled to false. Redo detection:
-- a card is a header when its FIRST block STARTS with bold — i.e. the line opens
-- with <strong>/<b> (tolerating leading <u>/<em>/<i>/<span>/<a> wrappers). This
-- targets title-style first lines and ignores bold that appears mid-sentence.
UPDATE journal_blocks
SET header_enabled = true
WHERE NOT is_scratch
  AND header_enabled = false
  AND content ~* '^\s*<(p|h[1-6]|li)[^>]*>\s*(<(u|em|i|span|a)[^>]*>\s*)*<(strong|b)[ />]';
