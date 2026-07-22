// RFC 9728 — OAuth 2.0 Protected Resource Metadata. Points MCP clients at the
// authorization server for /api/mcp. Also served at the path-aware variant
// /.well-known/oauth-protected-resource/api/mcp, which spec clients derive
// from the resource URL.
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const origin = new URL(request.url).origin
  return Response.json({
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp'],
  })
}
