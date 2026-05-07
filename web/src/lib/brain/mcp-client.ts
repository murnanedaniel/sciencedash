/**
 * Single source of truth for the MCP-client config the dashboard hands
 * out to consumers (per-project chat .mcp.json, brain-chat launcher,
 * the global heartbeat's spawned Claude subprocess).
 *
 * Every MCP request to ScienceDash now lands at /api/mcp, which the
 * proxy gates on `Authorization: Bearer <SCIENCEDASH_AUTH_TOKEN>` (or a
 * valid session cookie — but spawned subprocesses have no cookie). So
 * the canonical config carries the bearer header.
 *
 * Token is required: every consumer post-auth-cutover must supply one.
 * The type signature catches anyone trying to skip it.
 */

export type McpHttpServerConfig = {
  type: "http";
  url: string;
  headers: { Authorization: string };
};

export function buildMcpServerConfig(opts: {
  dashboardUrl: string;
  token: string;
}): McpHttpServerConfig {
  if (!opts.token) {
    throw new Error("buildMcpServerConfig: token is required");
  }
  return {
    type: "http",
    url: `${opts.dashboardUrl.replace(/\/$/, "")}/api/mcp`,
    headers: {
      Authorization: `Bearer ${opts.token}`,
    },
  };
}
