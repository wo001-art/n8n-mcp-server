const express = require('express');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
require('dotenv').config();

const app = express();
app.use(express.json());

// 환경변수 불러오기
const N8N_API_BASE_URL = process.env.N8N_API_BASE_URL || 'https://n8n.wookvan.com/api/v1';
const N8N_API_KEY = process.env.N8N_API_KEY || '';

// 1. 헬스 체크
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 2. OAuth 더미 엔드포인트
app.get('/oauth/authorize', (req, res) => {
  const { redirect_uri, state } = req.query;
  // 바로 통과시킴
  res.redirect(`${redirect_uri}?code=dummy-auth-code&state=${state}`);
});

app.post('/oauth/token', (req, res) => {
  res.json({
    access_token: 'dummy-access-token',
    token_type: 'Bearer',
    expires_in: 3600
  });
});

// 3. MCP 서버 설정
const server = new McpServer({
  name: 'n8n-extended-mcp',
  version: '1.0.0'
});

// ----------------------
// 도구(Tools) 정의 구간
// ----------------------

// Tool 1: 워크플로우 검색
server.tool('search_workflows', 'Search n8n workflows', {
  query: { type: 'string', description: 'Search query (optional)' }
}, async (args) => {
  try {
    const url = args.query 
      ? `${N8N_API_BASE_URL}/workflows?query=${encodeURIComponent(args.query)}`
      : `${N8N_API_BASE_URL}/workflows`;
      
    const response = await fetch(url, {
      headers: { 'X-N8N-API-KEY': N8N_API_KEY }
    });
    const data = await response.json();
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
  }
});

// Tool 2: 워크플로우 상세 조회
server.tool('get_workflow_details', 'Get workflow by ID', {
  workflowId: { type: 'string', description: 'Workflow ID' }
}, async (args) => {
  try {
    const response = await fetch(`${N8N_API_BASE_URL}/workflows/${args.workflowId}`, {
      headers: { 'X-N8N-API-KEY': N8N_API_KEY }
    });
    const data = await response.json();
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
  }
});

// Tool 3: 워크플로우 실행
server.tool('execute_workflow', 'Execute a workflow', {
  workflowId: { type: 'string', description: 'Workflow ID' },
  data: { type: 'object', description: 'Input data (optional JSON object)' }
}, async (args) => {
  try {
    const response = await fetch(`${N8N_API_BASE_URL}/workflows/${args.workflowId}/execute`, {
      method: 'POST',
      headers: {
        'X-N8N-API-KEY': N8N_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(args.data || {})
    });
    const data = await response.json();
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
  }
});

// 4. SSE 연결 설정 (Claude와 통신)
const transports = new Map();

app.get('/mcp/sse', async (req, res) => {
  console.log('New SSE connection initiated');
  const transport = new SSEServerTransport('/mcp/message', res);
  transports.set(transport.sessionId, transport);

  res.on('close', () => {
    console.log('SSE connection closed');
    transports.delete(transport.sessionId);
  });

  await server.connect(transport);
});

app.post('/mcp/message', async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports.get(sessionId);
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(404).json({ error: 'Session not found' });
  }
});

// 서버 시작
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ MCP Server running on port ${PORT}`);
});
