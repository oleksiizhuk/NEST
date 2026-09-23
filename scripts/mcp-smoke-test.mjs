// Smoke test for the /mcp bridge — talks to it with the same MCP client an IDE uses.
//
//   MCP_TOKEN='<your token>' node scripts/mcp-smoke-test.mjs [url]
//
// Default url is production. It lists the tools and makes one real ask_advice
// call (model: sonnet, so it is fast and cheap), then prints the answer.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = process.argv[2] || 'https://nest-ruby-theta.vercel.app/mcp';
const token = process.env.MCP_TOKEN;
if (!token) {
  console.error('Set MCP_TOKEN in the environment first.');
  process.exit(1);
}

const client = new Client({ name: 'smoke-test', version: '0.0.0' });
const transport = new StreamableHTTPClientTransport(new URL(url), {
  requestInit: { headers: { Authorization: `Bearer ${token}` } },
});

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  console.log('tools:', tools.map((t) => t.name).join(', ') || '(none)');

  console.log('calling ask_advice (model: sonnet)...');
  const started = Date.now();
  const res = await client.callTool(
    {
      name: 'ask_advice',
      arguments: { prompt: 'Reply with exactly one word: pong', model: 'sonnet' },
    },
    undefined,
    { timeout: 290000 },
  );
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const text = (res.content || []).map((c) => c.text).join('\n');
  console.log(`answer (${secs}s, isError=${Boolean(res.isError)}):`);
  console.log(text);
} catch (e) {
  console.error('FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => undefined);
}
