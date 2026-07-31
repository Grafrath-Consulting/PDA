import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { validateBearer, McpAuthError } from '@/lib/mcp/auth'
import { buildMcpServer } from '@/lib/mcp/server'

// Force Node runtime so jsonwebtoken-style crypto and the Supabase client work.
export const runtime = 'nodejs'
// MCP servers are dynamic per-request.
export const dynamic = 'force-dynamic'

// Streamable HTTP lets a client open a long-lived server->client notification
// stream with GET, and end a session with DELETE. This deployment is stateless
// and serverless: there is no session to end, nothing ever pushes a
// notification, and a Vercel function cannot hold a stream open — it just hangs
// until the gateway gives up and returns 504, which the client reports as
// "Failed to open SSE stream: Gateway Timeout" and treats as the connection
// dropping. 405 is the spec's signal for "no stream at this endpoint"; the
// client SDK handles it by continuing without one (and explicitly allows it for
// DELETE too), so request/response over POST keeps working.
//
// Auth still runs first, so an unauthenticated GET returns 401 with the
// WWW-Authenticate challenge that OAuth discovery depends on.
function methodNotAllowed(): Response {
  return Response.json(
    { error: 'This endpoint is stateless; use POST for JSON-RPC requests.' },
    { status: 405, headers: { Allow: 'POST' } }
  )
}

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

  if (req.method !== 'POST') return methodNotAllowed()

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
