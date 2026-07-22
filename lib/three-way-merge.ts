/**
 * Three-way merge for HTML block content, operating on top-level blocks.
 *
 * Given a common base, a local version ("ours"), and a remote version
 * ("theirs"), produces a merged result similar to diff3:
 *   - Blocks changed on only one side: take that side's change
 *   - Blocks added on one side: keep the addition (same-point additions
 *     from both sides are both kept, ours first)
 *   - Blocks removed on one side: apply the removal
 *   - Overlapping changes to the same blocks: take the incoming server
 *     version ("theirs") for that region — never both, never a hybrid
 *
 * Safety over cleverness: if any of the three versions cannot be split into
 * balanced top-level blocks, no structural merge is attempted and the
 * incoming server version is returned unchanged.
 */

/** Elements that never take a closing tag. */
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])

/**
 * Split HTML into balanced top-level chunks by tracking tag depth. The
 * concatenation of the returned parts is always exactly the input string.
 * Returns null when the markup is unbalanced and cannot be split safely.
 */
function splitBlocks(html: string): string[] | null {
  if (!html.trim()) return ['']
  const parts: string[] = []
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)(?:[^"'>]|"[^"]*"|'[^']*')*>/g
  let depth = 0
  let partStart = 0
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(html)) !== null) {
    const name = m[1].toLowerCase()
    if (m[0][1] === '/') {
      if (VOID_TAGS.has(name)) continue
      depth--
      if (depth < 0) return null
      if (depth === 0) {
        parts.push(html.slice(partStart, m.index + m[0].length))
        partStart = m.index + m[0].length
      }
    } else if (VOID_TAGS.has(name) || m[0].endsWith('/>')) {
      if (depth === 0) {
        parts.push(html.slice(partStart, m.index + m[0].length))
        partStart = m.index + m[0].length
      }
    } else {
      depth++
    }
  }
  if (depth !== 0) return null
  if (partStart < html.length) parts.push(html.slice(partStart))
  return parts
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

/** A contiguous change: replace baseParts[baseStart..baseEnd) with replacement. */
type Hunk = { baseStart: number; baseEnd: number; replacement: string[] }

/**
 * Group diff ops into hunks. An LCS diff represents a modified block as
 * delete(old)+insert(new); grouping adjacent non-equal ops keeps each
 * modification as one replace hunk instead of an unrelated delete/insert
 * pair, which is what lets the merge detect modify-vs-modify conflicts.
 */
function opsToHunks(ops: DiffOp[]): Hunk[] {
  const hunks: Hunk[] = []
  let baseIdx = 0
  let current: Hunk | null = null
  for (const op of ops) {
    if (op.type === 'equal') {
      current = null
      baseIdx++
    } else {
      if (!current) {
        current = { baseStart: baseIdx, baseEnd: baseIdx, replacement: [] }
        hunks.push(current)
      }
      if (op.type === 'delete') {
        baseIdx++
        current.baseEnd = baseIdx
      } else {
        current.replacement.push(op.value)
      }
    }
  }
  return hunks
}

function isInsert(h: Hunk): boolean {
  return h.baseStart === h.baseEnd
}

function overlaps(a: Hunk, b: Hunk): boolean {
  return a.baseStart < b.baseEnd && b.baseStart < a.baseEnd
}

/** Apply one side's hunks to baseParts[start..end) and return the result. */
function applyHunks(baseParts: string[], hunks: Hunk[], start: number, end: number): string {
  const out: string[] = []
  let idx = start
  for (const h of hunks) {
    while (idx < h.baseStart) out.push(baseParts[idx++])
    out.push(...h.replacement)
    idx = Math.max(idx, h.baseEnd)
  }
  while (idx < end) out.push(baseParts[idx++])
  return out.join('')
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
  // Unbalanced markup somewhere: a structural merge could corrupt content,
  // so take the incoming server version wholesale.
  if (!baseParts || !ourParts || !theirParts) return theirs

  const ourHunks = opsToHunks(diff(baseParts, ourParts))
  const theirHunks = opsToHunks(diff(baseParts, theirParts))

  const result: string[] = []
  let baseIdx = 0
  let oi = 0, ti = 0

  const emitBaseThrough = (end: number) => {
    while (baseIdx < end) result.push(baseParts[baseIdx++])
  }

  while (oi < ourHunks.length || ti < theirHunks.length) {
    const o = oi < ourHunks.length ? ourHunks[oi] : null
    const t = ti < theirHunks.length ? theirHunks[ti] : null

    // Both sides inserted new blocks at the same point: keep both additions
    // (ours first), or one copy when they are identical.
    if (o && t && isInsert(o) && isInsert(t) && o.baseStart === t.baseStart) {
      emitBaseThrough(o.baseStart)
      result.push(...o.replacement)
      if (o.replacement.join('') !== t.replacement.join('')) result.push(...t.replacement)
      oi++; ti++
      continue
    }

    if (o && t && overlaps(o, t)) {
      // Overlapping changes: grow the region until no further hunk from
      // either side touches it, then resolve the whole region as a unit.
      const start = Math.min(o.baseStart, t.baseStart)
      let end = Math.max(o.baseEnd, t.baseEnd)
      const oursIn: Hunk[] = []
      const theirsIn: Hunk[] = []
      let grew = true
      while (grew) {
        grew = false
        while (oi < ourHunks.length && ourHunks[oi].baseStart < end) {
          end = Math.max(end, ourHunks[oi].baseEnd)
          oursIn.push(ourHunks[oi++])
          grew = true
        }
        while (ti < theirHunks.length && theirHunks[ti].baseStart < end) {
          end = Math.max(end, theirHunks[ti].baseEnd)
          theirsIn.push(theirHunks[ti++])
          grew = true
        }
      }
      emitBaseThrough(start)
      const baseStr = baseParts.slice(start, end).join('')
      const oursStr = applyHunks(baseParts, oursIn, start, end)
      const theirsStr = applyHunks(baseParts, theirsIn, start, end)
      // Only ours effectively changed, or both made the same change: keep
      // ours. Otherwise the same blocks were edited on both sides — take the
      // incoming server version for the region, never both copies.
      if (theirsStr === baseStr || oursStr === theirsStr) result.push(oursStr)
      else result.push(theirsStr)
      baseIdx = end
      continue
    }

    // Next non-overlapping hunk: apply whichever starts first (a pure insert
    // applies before a replacement at the same position).
    let hunk: Hunk
    if (!o) { hunk = t!; ti++ }
    else if (!t) { hunk = o; oi++ }
    else if (o.baseStart < t.baseStart) { hunk = o; oi++ }
    else if (t.baseStart < o.baseStart) { hunk = t; ti++ }
    else if (isInsert(o)) { hunk = o; oi++ }
    else { hunk = t; ti++ }

    emitBaseThrough(hunk.baseStart)
    result.push(...hunk.replacement)
    baseIdx = Math.max(baseIdx, hunk.baseEnd)
  }
  emitBaseThrough(baseParts.length)

  return result.join('')
}
