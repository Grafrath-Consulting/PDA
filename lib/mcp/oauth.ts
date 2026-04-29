import crypto from 'crypto'
import { hashToken } from './tokens'

export const CLIENT_ID_PREFIX = 'pda_client_'
export const CLIENT_SECRET_PREFIX = 'pda_secret_'
export const AUTH_CODE_PREFIX = 'pda_code_'

const RANDOM_BYTES = 32

function genRandom(prefix: string): string {
  return `${prefix}${crypto.randomBytes(RANDOM_BYTES).toString('base64url')}`
}

export function generateClientCredentials(): {
  clientId: string
  clientSecret: string
  clientSecretHash: string
} {
  const clientId = genRandom(CLIENT_ID_PREFIX)
  const clientSecret = genRandom(CLIENT_SECRET_PREFIX)
  return {
    clientId,
    clientSecret,
    clientSecretHash: hashToken(clientSecret),
  }
}

export function generateAuthCode(): { raw: string; hash: string } {
  const raw = genRandom(AUTH_CODE_PREFIX)
  return { raw, hash: hashToken(raw) }
}

// Constant-time comparison to mitigate timing attacks on hash comparison.
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

// Verify a PKCE code_verifier against a stored code_challenge. Only S256 is
// supported (plain method is deprecated).
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  const computed = crypto.createHash('sha256').update(verifier).digest('base64url')
  return constantTimeEqual(computed, challenge)
}
