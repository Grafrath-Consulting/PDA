/**
 * Three-way merge for HTML block content, operating on paragraphs.
 *
 * Given a common base, a local version ("ours"), and a remote version ("theirs"),
 * produces a merged result similar to how git merge works:
 *   - Paragraphs changed only on one side: take that side's change
 *   - Paragraphs changed on both sides: keep local (user is actively editing)
 *   - Paragraphs added/removed: apply the addition/removal
 */

/** Split HTML into block-level chunks (paragraphs, headings, lists, etc.) */
function splitBlocks(html: string): string[] {
  if (!html.trim()) return ['']
  // Match block-level elements; fall back to treating the whole string as one block
  const blocks = html.match(/<(?:p|h[1-6]|ul|ol|li|blockquote|pre|div|hr)[^>]*>[\s\S]*?<\/(?:p|h[1-6]|ul|ol|li|blockquote|pre|div|hr)>|<hr\s*\/?>/gi)
  return blocks && blocks.length > 0 ? blocks : [html]
}

/**
 * Compute a simple LCS-based diff between two string arrays.
 * Returns a list of operations: 'equal', 'insert', 'delete'.
 */
type DiffOp = { type: 'equal'; value: string } | { type: 'insert'; value: string } | { type: 'delete'; value: string }

function diff(a: string[], b: string[]): DiffOp[] {
  const m = a.length, n = b.length
  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const ops: DiffOp[] = []
  let i = 0, j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      ops.push({ type: 'equal', value: a[i] })
      i++; j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'delete', value: a[i] })
      i++
    } else {
      ops.push({ type: 'insert', value: b[j] })
      j++
    }
  }
  while (i < m) { ops.push({ type: 'delete', value: a[i] }); i++ }
  while (j < n) { ops.push({ type: 'insert', value: b[j] }); j++ }
  return ops
}

/**
 * Three-way merge of HTML content.
 *
 * @param base  - The common ancestor (last known server version)
 * @param ours  - Local editor content
 * @param theirs - New server content
 * @returns merged HTML string
 */
export function threeWayMerge(base: string, ours: string, theirs: string): string {
  // Fast paths
  if (base === theirs) return ours     // No remote changes
  if (base === ours) return theirs     // No local changes
  if (ours === theirs) return ours     // Same changes on both sides

  const baseParts = splitBlocks(base)
  const ourParts = splitBlocks(ours)
  const theirParts = splitBlocks(theirs)

  // Build maps of what changed on each side relative to base
  const ourDiff = diff(baseParts, ourParts)
  const theirDiff = diff(baseParts, theirParts)

  // Walk both diffs together, keyed by base paragraph position
  const result: string[] = []
  let oi = 0, ti = 0

  while (oi < ourDiff.length || ti < theirDiff.length) {
    const o = oi < ourDiff.length ? ourDiff[oi] : null
    const t = ti < theirDiff.length ? theirDiff[ti] : null

    if (!o) {
      // Only theirs left
      if (t!.type !== 'delete') result.push(t!.value)
      ti++
      continue
    }
    if (!t) {
      // Only ours left
      if (o.type !== 'delete') result.push(o.value)
      oi++
      continue
    }

    // Both sides have an equal on the same base paragraph
    if (o.type === 'equal' && t.type === 'equal') {
      result.push(o.value)
      oi++; ti++
    }
    // Ours inserted something before the current base paragraph
    else if (o.type === 'insert') {
      result.push(o.value)
      oi++
    }
    // Theirs inserted something before the current base paragraph
    else if (t.type === 'insert') {
      result.push(t.value)
      ti++
    }
    // Both deleted the same base paragraph
    else if (o.type === 'delete' && t.type === 'delete') {
      oi++; ti++
    }
    // One side deleted, other kept equal — take the deletion
    else if (o.type === 'delete' && t.type === 'equal') {
      oi++; ti++
    }
    else if (o.type === 'equal' && t.type === 'delete') {
      oi++; ti++
    }
    // Fallback: conflicting edits — prefer ours (user is actively editing)
    else {
      if (o.type !== 'delete') result.push(o.value)
      oi++; ti++
    }
  }

  return result.join('')
}
