import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { validateBearer, McpAuthError } from '@/lib/mcp/auth'
import { buildMcpServer } from '@/lib/mcp/server'

// Force Node runtime so jsonwebtoken-style crypto and the Supabase client work.
export const runtime = 'nodejs'
// MCP servers are dynamic per-request.
export const dynamic = 'force-dynamic'

async function handle(req: Request): Promise<Response> {
  let userId: string
  try {
    ({ userId } = await validateBearer(req))
  } catch (e) {
    if (e instanceof McpAuthError) {
      // RFC 6750 §3: 401s must carry a WWW-Authenticate challenge; the
      // resource_metadata URI lets MCP clients discover the authorization
      // server (RFC 9728).
      const headers: Record<string, string> = {}
      if (e.status === 401) {
        const origin = new URL(req.url).origin
        headers['WWW-Authenticate'] = `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`
      }
      return Response.json({ error: e.message }, { status: e.status, headers })
    }
    throw e
  }

  const server = buildMcpServer(userId)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — bearer is the credential per request
  })
  await server.connect(transport)
  return transport.handleRequest(req)
}

export const POST = handle
export const GET = handle
export const DELETE = handle
