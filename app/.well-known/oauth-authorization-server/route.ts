// RFC 8414 — OAuth 2.0 Authorization Server Metadata. Lets MCP clients (and
// claude.ai's connector flow) auto-discover the authorize/token endpoints.
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const origin = new URL(request.url).origin
  return Response.json({
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
    scopes_supported: ['mcp'],
  })
}
