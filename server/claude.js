import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

let anthropic = null;
function getAnthropic() {
  if (!anthropic) anthropic = new Anthropic();
  return anthropic;
}

let mcpClient = null;
let cachedTools = null;
let initPromise = null;

async function init() {
  const transport = new StdioClientTransport({
    command: 'uvx',
    args: ['rhinomcp'],
    stderr: 'inherit',
  });
  mcpClient = new Client({ name: 'rhino-demo', version: '0.1' }, { capabilities: {} });
  await mcpClient.connect(transport);

  const { tools } = await mcpClient.listTools();
  cachedTools = tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
  if (cachedTools.length > 0) {
    cachedTools.at(-1).cache_control = { type: 'ephemeral' };
  }
  console.log(`MCP: loaded ${cachedTools.length} tool(s) from rhinomcp`);
}

function ensureInit() {
  if (!initPromise) {
    initPromise = init().catch(err => {
      console.error('MCP init failed:', err.message);
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

const SYSTEM = `You are a 3D modeling assistant connected to Rhino 3D. Use the available tools to create and modify geometry. After each tool call, confirm briefly what was done.

When creating objects in Rhino, always assign them a meaningful name using the available naming tool (e.g. "rabbit_body", "rabbit_tail", "table_leg_1"). This allows future conversations to identify and modify specific parts by name.`;

// conversations: id → { id, title, history, createdAt }
const conversations = new Map();

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function listConversations() {
  return [...conversations.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(({ id, title, createdAt }) => ({ id, title, createdAt }));
}

export function createConversation() {
  const id = newId();
  const conv = { id, title: 'New conversation', history: [], createdAt: Date.now() };
  conversations.set(id, conv);
  return { id, title: conv.title, createdAt: conv.createdAt };
}

export function deleteConversation(id) {
  return conversations.delete(id);
}

export async function chat(conversationId, userMessage, selectedIds = []) {
  await ensureInit();

  const conv = conversations.get(conversationId);
  if (!conv) throw new Error(`Conversation ${conversationId} not found`);

  let content = userMessage;
  if (selectedIds.length > 0) {
    content = `[The user has selected ${selectedIds.length} Rhino object(s) by ID: ${selectedIds.join(', ')}. Apply the following instruction specifically to these objects.]\n\n${userMessage}`;
  }

  // Auto-title from first user message
  if (conv.history.length === 0) {
    conv.title = userMessage.slice(0, 45) + (userMessage.length > 45 ? '…' : '');
  }

  conv.history.push({ role: 'user', content });
  const messages = [...conv.history];
  let toolsUsed = false;

  while (true) {
    const response = await getAnthropic().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      system: SYSTEM,
      tools: cachedTools,
      messages,
    });

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'tool_use') {
      toolsUsed = true;
      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        let result;
        try {
          const mcpResult = await mcpClient.callTool({ name: block.name, arguments: block.input });
          result = JSON.stringify(mcpResult);
        } catch (err) {
          result = `Error: ${err.message}`;
        }
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
      }
      messages.push({ role: 'user', content: toolResults });
    } else {
      const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
      conv.history.push({ role: 'assistant', content: response.content });
      return { text, toolsUsed, title: conv.title };
    }
  }
}
