const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ type: ['application/json', 'application/vscode-jsonrpc'] }));
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || 'https://n8n.wookvan.com';
const N8N_API_URL = process.env.N8N_API_BASE_URL;
const N8N_API_KEY = process.env.N8N_API_KEY;

const db = { clients: new Map(), authCodes: new Map() };
const sessions = new Map();

function verifyPKCE(verifier, challenge, method) {
  if (method === 'plain') return verifier === challenge;
  const hash = crypto.createHash('sha256').update(verifier).digest();
  return hash.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') === challenge;
}

app.get('/.well-known/oauth-authorization-server', (req, res) => {
  res.json({ issuer: BASE_URL, authorization_endpoint: `${BASE_URL}/oauth/authorize`, token_endpoint: `${BASE_URL}/oauth/token`, registration_endpoint: `${BASE_URL}/oauth/register`, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256', 'plain'], token_endpoint_auth_methods_supported: ['client_secret_post', 'none'] });
});

app.post('/oauth/register', (req, res) => {
  const client_id = crypto.randomBytes(16).toString('hex');
  const client_secret = crypto.randomBytes(32).toString('hex');
  db.clients.set(client_id, { client_id, client_secret });
  res.status(201).json({ client_id, client_secret, client_name: req.body.client_name || 'Claude', redirect_uris: req.body.redirect_uris, grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'client_secret_post' });
});

app.get('/oauth/authorize', (req, res) => {
  const { client_id, redirect_uri, state, code_challenge, code_challenge_method } = req.query;
  const sessionId = crypto.randomBytes(16).toString('hex');
  db.authCodes.set(sessionId, { client_id, redirect_uri, state, code_challenge, code_challenge_method: code_challenge_method || 'S256', type: 'session' });
  res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:50px;"><h2>n8n MCP Server</h2><p>Allow Claude to access n8n?</p><form action="/oauth/consent" method="POST"><input type="hidden" name="session_id" value="${sessionId}"><button type="submit" style="padding:15px 30px;font-size:16px;">Allow</button></form></body></html>`);
});

app.post('/oauth/consent', (req, res) => {
  const session = db.authCodes.get(req.body.session_id);
  if (!session) return res.status(400).send('Expired');
  const code = crypto.randomBytes(32).toString('hex');
  db.authCodes.delete(req.body.session_id);
  db.authCodes.set(code, { ...session, type: 'code' });
  const url = new URL(session.redirect_uri);
  url.searchParams.set('code', code);
  if (session.state) url.searchParams.set('state', session.state);
  res.redirect(url.toString());
});

app.post('/oauth/token', (req, res) => {
  const { code, code_verifier } = req.body;
  const authCode = db.authCodes.get(code);
  if (!authCode || authCode.type !== 'code') return res.status(400).json({ error: 'invalid_grant' });
  if (authCode.code_challenge && code_verifier && !verifyPKCE(code_verifier, authCode.code_challenge, authCode.code_challenge_method)) return res.status(400).json({ error: 'invalid_grant' });
  db.authCodes.delete(code);
  res.json({ access_token: crypto.randomBytes(32).toString('hex'), token_type: 'Bearer', expires_in: 3600, refresh_token: crypto.randomBytes(32).toString('hex') });
});

const TOOLS = [
  { name: "search_workflows", description: "Search n8n workflows by name", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
  { name: "get_workflow", description: "Get workflow details by ID", inputSchema: { type: "object", properties: { workflowId: { type: "string" } }, required: ["workflowId"] } },
  { name: "create_workflow", description: "Create a new workflow", inputSchema: { type: "object", properties: { name: { type: "string" }, nodes: { type: "array" }, connections: { type: "object" } }, required: ["name"] } },
  { name: "update_workflow", description: "Update a workflow", inputSchema: { type: "object", properties: { workflowId: { type: "string" }, name: { type: "string" }, nodes: { type: "array" }, connections: { type: "object" } }, required: ["workflowId"] } },
  { name: "delete_workflow", description: "Delete a workflow", inputSchema: { type: "object", properties: { workflowId: { type: "string" } }, required: ["workflowId"] } },
  { name: "activate_workflow", description: "Activate a workflow", inputSchema: { type: "object", properties: { workflowId: { type: "string" } }, required: ["workflowId"] } },
  { name: "deactivate_workflow", description: "Deactivate a workflow", inputSchema: { type: "object", properties: { workflowId: { type: "string" } }, required: ["workflowId"] } },
  { name: "execute_workflow", description: "Execute workflow", inputSchema: { type: "object", properties: { workflowId: { type: "string" }, data: { type: "object" } }, required: ["workflowId"] } },
  { name: "get_workflow_tags", description: "Get tags of a workflow", inputSchema: { type: "object", properties: { workflowId: { type: "string" } }, required: ["workflowId"] } },
  { name: "update_workflow_tags", description: "Update tags of a workflow", inputSchema: { type: "object", properties: { workflowId: { type: "string" }, tagIds: { type: "array" } }, required: ["workflowId", "tagIds"] } },
  { name: "get_workflow_version", description: "Get specific version of a workflow", inputSchema: { type: "object", properties: { workflowId: { type: "string" }, versionId: { type: "string" } }, required: ["workflowId", "versionId"] } },
  { name: "transfer_workflow", description: "Transfer workflow to another project", inputSchema: { type: "object", properties: { workflowId: { type: "string" }, destinationProjectId: { type: "string" } }, required: ["workflowId", "destinationProjectId"] } },
  { name: "call_webhook", description: "Call webhook URL to trigger workflow", inputSchema: { type: "object", properties: { webhookPath: { type: "string" }, method: { type: "string" }, data: { type: "object" } }, required: ["webhookPath"] } },
  { name: "get_executions", description: "Get execution history", inputSchema: { type: "object", properties: { workflowId: { type: "string" }, limit: { type: "number" }, status: { type: "string" } } } },
  { name: "get_execution", description: "Get execution details", inputSchema: { type: "object", properties: { executionId: { type: "string" } }, required: ["executionId"] } },
  { name: "delete_execution", description: "Delete an execution", inputSchema: { type: "object", properties: { executionId: { type: "string" } }, required: ["executionId"] } },
  { name: "retry_execution", description: "Retry a failed execution", inputSchema: { type: "object", properties: { executionId: { type: "string" }, loadWorkflow: { type: "boolean" } }, required: ["executionId"] } },
  { name: "list_credentials", description: "List all credentials", inputSchema: { type: "object", properties: {} } },
  { name: "create_credential", description: "Create a new credential", inputSchema: { type: "object", properties: { name: { type: "string" }, type: { type: "string" }, data: { type: "object" } }, required: ["name", "type", "data"] } },
  { name: "get_credential_schema", description: "Get credential type schema", inputSchema: { type: "object", properties: { credentialType: { type: "string" } }, required: ["credentialType"] } },
  { name: "delete_credential", description: "Delete a credential", inputSchema: { type: "object", properties: { credentialId: { type: "string" } }, required: ["credentialId"] } },
  { name: "list_tags", description: "List all tags", inputSchema: { type: "object", properties: {} } },
  { name: "create_tag", description: "Create a tag", inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "get_tag", description: "Get a tag by ID", inputSchema: { type: "object", properties: { tagId: { type: "string" } }, required: ["tagId"] } },
  { name: "update_tag", description: "Update a tag", inputSchema: { type: "object", properties: { tagId: { type: "string" }, name: { type: "string" } }, required: ["tagId", "name"] } },
  { name: "delete_tag", description: "Delete a tag", inputSchema: { type: "object", properties: { tagId: { type: "string" } }, required: ["tagId"] } },
  { name: "generate_audit", description: "Generate security audit report", inputSchema: { type: "object", properties: { categories: { type: "array" } } } },
  { name: "list_users", description: "List all users (Owner only)", inputSchema: { type: "object", properties: { includeRole: { type: "boolean" }, limit: { type: "number" } } } },
  { name: "get_user", description: "Get user by ID (Owner only)", inputSchema: { type: "object", properties: { userId: { type: "string" } }, required: ["userId"] } },
  { name: "create_user", description: "Create user (Owner only)", inputSchema: { type: "object", properties: { email: { type: "string" }, role: { type: "string" } }, required: ["email"] } },
  { name: "delete_user", description: "Delete a user (Owner only)", inputSchema: { type: "object", properties: { userId: { type: "string" } }, required: ["userId"] } },
  { name: "change_user_role", description: "Change user role (Owner only)", inputSchema: { type: "object", properties: { userId: { type: "string" }, newRole: { type: "string" } }, required: ["userId", "newRole"] } }
];

async function handleTool(name, args) {
  console.log('TOOL:', name, JSON.stringify(args));
  const headers = { 'X-N8N-API-KEY': N8N_API_KEY, 'Content-Type': 'application/json' };
  if (name === 'search_workflows') { const r = await axios.get(`${N8N_API_URL}/workflows`, { headers }); const w = r.data.data || []; return args.query ? w.filter(x => x.name.toLowerCase().includes(args.query.toLowerCase())).map(x => ({ id: x.id, name: x.name, active: x.active })) : w.map(x => ({ id: x.id, name: x.name, active: x.active })); }
  if (name === 'get_workflow') { const r = await axios.get(`${N8N_API_URL}/workflows/${args.workflowId}`, { headers }); return r.data; }
  if (name === 'create_workflow') { const r = await axios.post(`${N8N_API_URL}/workflows`, { name: args.name, nodes: args.nodes || [], connections: args.connections || {}, settings: { executionOrder: 'v1' } }, { headers }); return { id: r.data.id, name: r.data.name, message: 'Created' }; }
  if (name === 'update_workflow') { const c = await axios.get(`${N8N_API_URL}/workflows/${args.workflowId}`, { headers }); const r = await axios.put(`${N8N_API_URL}/workflows/${args.workflowId}`, { name: args.name || c.data.name, nodes: args.nodes || c.data.nodes, connections: args.connections || c.data.connections, settings: c.data.settings }, { headers }); return { id: r.data.id, name: r.data.name, message: 'Updated' }; }
  if (name === 'delete_workflow') { await axios.delete(`${N8N_API_URL}/workflows/${args.workflowId}`, { headers }); return { workflowId: args.workflowId, message: 'Deleted' }; }
  if (name === 'activate_workflow') { const r = await axios.post(`${N8N_API_URL}/workflows/${args.workflowId}/activate`, {}, { headers }); return { id: r.data.id, active: r.data.active, message: 'Activated' }; }
  if (name === 'deactivate_workflow') { const r = await axios.post(`${N8N_API_URL}/workflows/${args.workflowId}/deactivate`, {}, { headers }); return { id: r.data.id, active: r.data.active, message: 'Deactivated' }; }
  if (name === 'execute_workflow') { const r = await axios.post(`${N8N_API_URL}/workflows/${args.workflowId}/run`, args.data || {}, { headers }); return r.data; }
  if (name === 'get_workflow_tags') { const r = await axios.get(`${N8N_API_URL}/workflows/${args.workflowId}/tags`, { headers }); return r.data; }
  if (name === 'update_workflow_tags') { const r = await axios.put(`${N8N_API_URL}/workflows/${args.workflowId}/tags`, args.tagIds.map(id => ({ id })), { headers }); return r.data; }
  if (name === 'get_workflow_version') { const r = await axios.get(`${N8N_API_URL}/workflows/${args.workflowId}/${args.versionId}`, { headers }); return r.data; }
  if (name === 'transfer_workflow') { const r = await axios.put(`${N8N_API_URL}/workflows/${args.workflowId}/transfer`, { destinationProjectId: args.destinationProjectId }, { headers }); return r.data; }
  if (name === 'call_webhook') { const url = args.webhookPath.startsWith('http') ? args.webhookPath : `${BASE_URL}/webhook/${args.webhookPath}`; const m = (args.method || 'POST').toUpperCase(); const r = m === 'GET' ? await axios.get(url) : await axios.post(url, args.data || {}); return r.data; }
  if (name === 'get_executions') { let url = `${N8N_API_URL}/executions?`; if (args.workflowId) url += `workflowId=${args.workflowId}&`; if (args.limit) url += `limit=${args.limit}&`; if (args.status) url += `status=${args.status}&`; const r = await axios.get(url, { headers }); return r.data.data || r.data; }
  if (name === 'get_execution') { const r = await axios.get(`${N8N_API_URL}/executions/${args.executionId}`, { headers }); return r.data; }
  if (name === 'delete_execution') { await axios.delete(`${N8N_API_URL}/executions/${args.executionId}`, { headers }); return { executionId: args.executionId, message: 'Deleted' }; }
  if (name === 'retry_execution') { const r = await axios.post(`${N8N_API_URL}/executions/${args.executionId}/retry`, args.loadWorkflow !== undefined ? { loadWorkflow: args.loadWorkflow } : {}, { headers }); return r.data; }
  if (name === 'list_credentials') { const r = await axios.get(`${N8N_API_URL}/credentials`, { headers }); return r.data.data || r.data; }
  if (name === 'create_credential') { const r = await axios.post(`${N8N_API_URL}/credentials`, { name: args.name, type: args.type, data: args.data }, { headers }); return { id: r.data.id, name: r.data.name, message: 'Created' }; }
  if (name === 'get_credential_schema') { const r = await axios.get(`${N8N_API_URL}/credentials/schema/${args.credentialType}`, { headers }); return r.data; }
  if (name === 'delete_credential') { await axios.delete(`${N8N_API_URL}/credentials/${args.credentialId}`, { headers }); return { credentialId: args.credentialId, message: 'Deleted' }; }
  if (name === 'list_tags') { const r = await axios.get(`${N8N_API_URL}/tags`, { headers }); return r.data.data || r.data; }
  if (name === 'create_tag') { const r = await axios.post(`${N8N_API_URL}/tags`, { name: args.name }, { headers }); return { id: r.data.id, name: r.data.name, message: 'Created' }; }
  if (name === 'get_tag') { const r = await axios.get(`${N8N_API_URL}/tags/${args.tagId}`, { headers }); return r.data; }
  if (name === 'update_tag') { const r = await axios.put(`${N8N_API_URL}/tags/${args.tagId}`, { name: args.name }, { headers }); return { id: r.data.id, name: r.data.name, message: 'Updated' }; }
  if (name === 'delete_tag') { await axios.delete(`${N8N_API_URL}/tags/${args.tagId}`, { headers }); return { tagId: args.tagId, message: 'Deleted' }; }
  if (name === 'generate_audit') { const r = await axios.post(`${N8N_API_URL}/audit`, args.categories ? { categories: args.categories } : {}, { headers }); return r.data; }
  if (name === 'list_users') { let url = `${N8N_API_URL}/users?`; if (args.includeRole) url += `includeRole=true&`; if (args.limit) url += `limit=${args.limit}&`; const r = await axios.get(url, { headers }); return r.data.data || r.data; }
  if (name === 'get_user') { const r = await axios.get(`${N8N_API_URL}/users/${args.userId}`, { headers }); return r.data; }
  if (name === 'create_user') { const r = await axios.post(`${N8N_API_URL}/users`, [{ email: args.email, role: args.role || 'global:member' }], { headers }); return r.data; }
  if (name === 'delete_user') { await axios.delete(`${N8N_API_URL}/users/${args.userId}`, { headers }); return { userId: args.userId, message: 'Deleted' }; }
  if (name === 'change_user_role') { const r = await axios.patch(`${N8N_API_URL}/users/${args.userId}/role`, { newRoleName: args.newRole }, { headers }); return r.data; }
  throw new Error('Unknown tool: ' + name);
}

app.get('/mcp/sse', (req, res) => {
  const sessionId = uuidv4();
  console.log('SSE START:', sessionId);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(`event: endpoint\ndata: ${BASE_URL}/mcp/message?sessionId=${sessionId}\n\n`);
  sessions.set(sessionId, res);
  const keepAlive = setInterval(() => res.write(':keep-alive\n\n'), 15000);
  req.on('close', () => { clearInterval(keepAlive); sessions.delete(sessionId); });
});

app.post('/mcp/message', async (req, res) => {
  const sessionId = req.query.sessionId;
  const sseRes = sessions.get(sessionId);
  if (!sseRes) return res.status(404).json({ error: 'Session not found' });
  const msg = req.body;
  if (msg.id === undefined && msg.id !== 0) return res.status(200).end();
  let response = null;
  if (msg.method === 'initialize') response = { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'n8n-mcp', version: '2.0.0' } } };
  else if (msg.method === 'tools/list') { response = { jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } }; console.log('Tools:', TOOLS.length); }
  else if (msg.method === 'tools/call') { try { const result = await handleTool(msg.params.name, msg.params.arguments || {}); response = { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } }; } catch (e) { response = { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'Error: ' + (e.response?.data?.message || e.message) }], isError: true } }; } }
  else response = { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } };
  if (response) sseRes.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
  res.status(200).end();
});

app.get('/health', (req, res) => res.json({ status: 'ok', tools: TOOLS.length }));
app.listen(PORT, '0.0.0.0', () => console.log(`MCP Server v2.0 - ${TOOLS.length} tools on port ${PORT}`));
