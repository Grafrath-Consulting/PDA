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

// Signed, short-lived consent nonce binding the authorize consent form to the
// user/client/redirect_uri it was rendered for, so a cross-site POST cannot
// forge an approval. Keyed off the server-only service-role secret.
const CONSENT_NONCE_TTL_MS = 10 * 60 * 1000

function consentKey(): Buffer {
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!secret) throw new Error('SUPABASE_SECRET_KEY is not set')
  return crypto.createHash('sha256').update(`pda-oauth-consent:${secret}`).digest()
}

function consentSig(userId: string, clientId: string, redirectUri: string, exp: number): string {
  return crypto.createHmac('sha256', consentKey())
    .update(`${userId}\n${clientId}\n${redirectUri}\n${exp}`)
    .digest('base64url')
}

export function createConsentNonce(userId: string, clientId: string, redirectUri: string): string {
  const exp = Date.now() + CONSENT_NONCE_TTL_MS
  return `${exp}.${consentSig(userId, clientId, redirectUri, exp)}`
}

export function verifyConsentNonce(nonce: string, userId: string, clientId: string, redirectUri: string): boolean {
  const dot = nonce.indexOf('.')
  if (dot === -1) return false
  const exp = Number(nonce.slice(0, dot))
  if (!Number.isFinite(exp) || exp < Date.now()) return false
  return constantTimeEqual(nonce.slice(dot + 1), consentSig(userId, clientId, redirectUri, exp))
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
