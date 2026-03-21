export type DateFormatOption = 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD' | 'Mon DD, YYYY'
export type TimeFormatOption = '12h' | '24h'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Format a Date's date portion according to the user's preference */
export function formatDatePart(d: Date, fmt: DateFormatOption): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const yyyy = String(d.getFullYear())
  switch (fmt) {
    case 'DD/MM/YYYY': return `${dd}/${mm}/${yyyy}`
    case 'YYYY-MM-DD': return `${yyyy}-${mm}-${dd}`
    case 'Mon DD, YYYY': return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${yyyy}`
    case 'MM/DD/YYYY':
    default: return `${mm}/${dd}/${yyyy}`
  }
}

/** Format a Date's time portion according to the user's preference */
export function formatTimePart(d: Date, fmt: TimeFormatOption): string {
  const h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  if (fmt === '24h') {
    return `${String(h).padStart(2, '0')}:${m}`
  }
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${m} ${period}`
}

/** Format a full timestamp string (ISO) for display */
export function formatTimestamp(
  iso: string,
  dateFmt: DateFormatOption,
  timeFmt: TimeFormatOption,
): string {
  const d = new Date(iso)
  return `${formatDatePart(d, dateFmt)}, ${formatTimePart(d, timeFmt)}`
}

/** Format a due-date timestamp, hiding the time if it's the 23:59:59 sentinel */
export function formatDueDate(
  iso: string,
  dateFmt: DateFormatOption,
  timeFmt: TimeFormatOption,
): string {
  // Strip timezone to parse as local
  const localStr = iso.replace(/Z$/i, '').replace(/[+-]\d{2}:\d{2}$/, '')
  const d = new Date(localStr)
  const dateStr = formatDatePart(d, dateFmt)
  const hh = d.getHours(), mi = d.getMinutes(), ss = d.getSeconds()
  if (hh === 23 && mi === 59 && ss === 59) return dateStr
  return `${dateStr} ${formatTimePart(d, timeFmt)}`
}
