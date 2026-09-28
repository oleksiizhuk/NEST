// A failure whose message is safe to show the MCP caller: it tells the
// caller what to do next and carries no upstream detail
export class McpToolError extends Error {}
