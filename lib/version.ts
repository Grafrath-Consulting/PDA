export const APP_VERSION = {
  major: 0,
  minor: 2,
  build: 95,
  buildDate: '2026-04-26T18:49:31-05:00',
}

export function versionString() {
  const { major, minor, build } = APP_VERSION
  return `v${major}.${minor}.${build}`
}

export function buildDateString() {
  return new Date(APP_VERSION.buildDate).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
