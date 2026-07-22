// Path-aware RFC 9728 well-known URI for the /api/mcp resource — same
// document as /.well-known/oauth-protected-resource.
export { GET } from '../../route'

// Segment config must be declared locally to be statically analyzable.
export const dynamic = 'force-dynamic'
