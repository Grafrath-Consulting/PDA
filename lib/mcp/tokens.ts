import crypto from 'crypto'

export const TOKEN_PREFIX = 'pda_mcp_'
const RANDOM_BYTES = 32
const PREFIX_DISPLAY_LENGTH = 12

export function generateToken(): { raw: string; hash: string; displayPrefix: string } {
  const random = crypto.randomBytes(RANDOM_BYTES).toString('base64url')
  const raw = `${TOKEN_PREFIX}${random}`
  return {
    raw,
    hash: hashToken(raw),
    displayPrefix: raw.slice(0, PREFIX_DISPLAY_LENGTH),
  }
}

export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}
