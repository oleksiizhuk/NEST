// Smoke test for the /mcp bridge — walks the task protocol with the same MCP
// client an IDE uses:
//
//   MCP_TOKEN='<your token>' node scripts/mcp-smoke-test.mjs [url]
//
// Default url is production. As client "smoke" it lists the tools, starts a
// task, asks one question with code (model: sonnet, fast and cheap), lists
// open tasks, reports the task solved, then checks that a bare question gets
// a checklist and closes that task as abandoned. Two cheap model calls.
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
  requestInit: {
    headers: { Authorization: `Bearer ${token}`, 'X-MCP-Client': 'smoke' },
  },
});
const text = (res) => (res.content || []).map((c) => c.text).join('\n');
const call = async (name, args) => {
  const started = Date.now();
  const res = await client.callTool({ name, arguments: args }, undefined, {
    timeout: 290000,
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n=== ${name} (${secs}s, isError=${Boolean(res.isError)})`);
  console.log(text(res));
  if (res.isError) throw new Error(`${name} failed`);
  return text(res);
};
const taskId = (reply) => /\b(t-[0-9a-f]{10})\b/.exec(reply)?.[1];

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  console.log('tools:', tools.map((t) => t.name).join(', ') || '(none)');

  const started = await call('start_task', {
    goal: 'Smoke test: add(a, b) returns a string instead of a number',
  });
  const id = taskId(started);
  const code =
    'function add(a, b) {\n  return `${a}` + b;\n}\n' +
    '// add(1, 2) returns "12", expected 3\n'.repeat(4);
  await call('ask_advice', {
    task_id: id,
    prompt: 'Why does add(1, 2) return "12"? Fix it.',
    context: code,
    model: 'sonnet',
  });
  await call('list_open_tasks', {});
  await call('report_outcome', {
    task_id: id,
    status: 'solved',
    details: 'smoke test: return a + b; add(1, 2) === 3',
  });

  const bare = await call('ask_advice', {
    prompt: 'How do I speed up my app?',
  });
  if (!bare.includes('not answered yet')) {
    throw new Error('a bare question should get the checklist first');
  }
  await call('report_outcome', {
    task_id: taskId(bare),
    status: 'abandoned',
    details: 'smoke test',
  });
  console.log('\nOK');
} catch (e) {
  console.error('FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => undefined);
}
