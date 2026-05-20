import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFileSync } from 'fs';

// Match the launch command from your Claude Desktop config
// (claude_desktop_config.json → mcpServers → rhino → command/args)
const transport = new StdioClientTransport({
  command: 'uvx',
  args: ['rhinomcp'],
});

const client = new Client({ name: 'rhino-demo', version: '0.1' }, { capabilities: {} });
await client.connect(transport);

const { tools } = await client.listTools();
await client.close();

const anthropicTools = tools.map(t => ({
  name: t.name,
  description: t.description,
  input_schema: t.inputSchema,
}));

writeFileSync(
  new URL('../tools.json', import.meta.url),
  JSON.stringify(anthropicTools, null, 2)
);

console.log(`Saved ${anthropicTools.length} tool(s) to tools.json`);
