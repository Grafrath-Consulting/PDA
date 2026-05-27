export type DateFormatOption = 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD' | 'Mon DD, YYYY'
export type TimeFormatOption = '12h' | '24h'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const pad = (n: number) => String(n).padStart(2, '0')

// ── Pure component formatters (no Date/timezone involved) ────────────
function fmtDate(year: number, month: number, day: number, fmt: DateFormatOption): string {
  const mm = pad(month)
  const dd = pad(day)
  const yyyy = String(year)
  switch (fmt) {
    case 'DD/MM/YYYY': return `${dd}/${mm}/${yyyy}`
    case 'YYYY-MM-DD': return `${yyyy}-${mm}-${dd}`
    case 'Mon DD, YYYY': return `${MONTH_NAMES[month - 1]} ${day}, ${yyyy}`
    case 'MM/DD/YYYY':
    default: return `${mm}/${dd}/${yyyy}`
  }
}

function fmtTime(hour: number, minute: number, fmt: TimeFormatOption): string {
  const m = pad(minute)
  if (fmt === '24h') return `${pad(hour)}:${m}`
  const period = hour >= 12 ? 'PM' : 'AM'
  const h12 = hour % 12 || 12
  return `${h12}:${m} ${period}`
}

// ── Date-based helpers (operate on a Date's local components) ─────────
// Used to render a plain "YYYY-MM-DD" picker value, which is already the
// wall-clock date the user selected — no timezone conversion needed.
export function formatDatePart(d: Date, fmt: DateFormatOption): string {
  return fmtDate(d.getFullYear(), d.getMonth() + 1, d.getDate(), fmt)
}

export function formatTimePart(d: Date, fmt: TimeFormatOption): string {
  return fmtTime(d.getHours(), d.getMinutes(), fmt)
}

// ── Timezone-aware instant helpers ───────────────────────────────────
export interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

/** Wall-clock components of a UTC instant as seen in the given IANA zone. */
export function zonedParts(iso: string, timeZone: string): ZonedParts {
  const date = new Date(iso)
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })
  const map: Record<string, string> = {}
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = part.value
  }
  // Some engines emit hour "24" at midnight with hour12:false — normalise to 0.
  let hour = Number(map.hour)
  if (hour === 24) hour = 0
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
  }
}

/** "YYYY-MM-DD" of an instant in the given zone. */
export function zonedDateStr(iso: string, timeZone: string): string {
  const p = zonedParts(iso, timeZone)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** "HH:MM" (24h) of an instant in the given zone. */
export function zonedTimeStr(iso: string, timeZone: string): string {
  const p = zonedParts(iso, timeZone)
  return `${pad(p.hour)}:${pad(p.minute)}`
}

/**
 * Convert a wall-clock date+time interpreted in `timeZone` to a UTC ISO instant.
 * dateStr: "YYYY-MM-DD", timeStr: "HH:MM" or "HH:MM:SS".
 */
export function zonedToUtcIso(dateStr: string, timeStr: string, timeZone: string): string {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const t = timeStr.split(':').map(Number)
  const h = t[0] ?? 0, mi = t[1] ?? 0, s = t[2] ?? 0
  // Treat the wall-clock as if it were UTC, then correct by the zone's offset
  // at that instant (handles DST automatically, per date).
  const utcGuess = Date.UTC(y, mo - 1, d, h, mi, s)
  const p = zonedParts(new Date(utcGuess).toISOString(), timeZone)
  const zoneWallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  const offset = zoneWallAsUtc - utcGuess
  return new Date(utcGuess - offset).toISOString()
}

/** Format a full timestamp (ISO instant) for display in the user's zone. */
export function formatTimestamp(
  iso: string,
  dateFmt: DateFormatOption,
  timeFmt: TimeFormatOption,
  timeZone: string,
): string {
  const p = zonedParts(iso, timeZone)
  return `${fmtDate(p.year, p.month, p.day, dateFmt)}, ${fmtTime(p.hour, p.minute, timeFmt)}`
}

// ── Date-only sentinels ──────────────────────────────────────────────
// Date-only due dates are stored as `YYYY-MM-DDT23:59:59Z` (literal UTC),
// and date-only start dates as `YYYY-MM-DDT00:00:00Z`. Storing them as
// fixed UTC instants — not zone-converted — keeps the calendar date the
// same regardless of which zone the viewer is in (like "Christmas is Dec
// 25 everywhere").

// Detection ignores seconds: the 30-minute picker can't produce 23:59 or
// 00:00:30, so any UTC instant whose hour/minute matches the sentinel was
// written as date-only intent — either by us (23:59:59Z / 00:00:00Z) or by
// an MCP client that sent `T23:59:00-05:00` style "end of day" timestamps.
export function isDueDateOnly(iso: string): boolean {
  const d = new Date(iso)
  return d.getUTCHours() === 23 && d.getUTCMinutes() === 59
}

export function isStartDateOnly(iso: string): boolean {
  const d = new Date(iso)
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0
}

/** "YYYY-MM-DD" of the UTC date of an instant. */
export function utcDateStr(iso: string): string {
  const d = new Date(iso)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** Build the stored ISO for a due date — UTC sentinel if no time. */
export function buildDueDateIso(date: string, time: string | null, timeZone: string): string {
  if (!time) return `${date}T23:59:59.000Z`
  const t = time.includes(':') && time.split(':').length === 3 ? time : `${time}:00`
  return zonedToUtcIso(date, t, timeZone)
}

/** Build the stored ISO for a start date — UTC sentinel if no time. */
export function buildStartDateIso(date: string, time: string | null, timeZone: string): string {
  if (!time) return `${date}T00:00:00.000Z`
  const t = time.includes(':') && time.split(':').length === 3 ? time : `${time}:00`
  return zonedToUtcIso(date, t, timeZone)
}

/** Calendar day of a due date — UTC date for date-only, zoned date otherwise. */
export function dueDateDayStr(iso: string, timeZone: string): string {
  return isDueDateOnly(iso) ? utcDateStr(iso) : zonedDateStr(iso, timeZone)
}

/** Calendar day of a start date — UTC date for date-only, zoned date otherwise. */
export function startDateDayStr(iso: string, timeZone: string): string {
  return isStartDateOnly(iso) ? utcDateStr(iso) : zonedDateStr(iso, timeZone)
}

/**
 * Format a due-date instant for display. Date-only sentinels render as a
 * bare date (no zone adjustment); date+time renders in the user's zone.
 */
export function formatDueDate(
  iso: string,
  dateFmt: DateFormatOption,
  timeFmt: TimeFormatOption,
  timeZone: string,
): string {
  if (isDueDateOnly(iso)) {
    const d = new Date(iso)
    return fmtDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), dateFmt)
  }
  const p = zonedParts(iso, timeZone)
  return `${fmtDate(p.year, p.month, p.day, dateFmt)} ${fmtTime(p.hour, p.minute, timeFmt)}`
}
