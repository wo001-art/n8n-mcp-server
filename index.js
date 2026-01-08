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

const NODES_DB = {
  nodes: [
    { name: "Webhook", type: "n8n-nodes-base.webhook", category: "Core", description: "HTTP 요청을 받아 워크플로우를 트리거", isTrigger: true, essentials: { requiredParams: ["httpMethod", "path"], optionalParams: ["authentication", "responseMode"], httpMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"], responseMode: ["onReceived", "lastNode", "responseNode"] }, example: { httpMethod: "POST", path: "my-webhook", responseMode: "onReceived" } },
    { name: "HTTP Request", type: "n8n-nodes-base.httpRequest", category: "Core", description: "외부 API 호출", isTrigger: false, essentials: { requiredParams: ["method", "url"], optionalParams: ["authentication", "sendBody", "sendQuery", "sendHeaders"], methods: ["GET", "POST", "PUT", "PATCH", "DELETE"] }, example: { method: "POST", url: "https://api.example.com/data", sendBody: true } },
    { name: "Code", type: "n8n-nodes-base.code", category: "Core", description: "JavaScript/Python 코드 실행", isTrigger: false, essentials: { requiredParams: ["mode", "jsCode"], modes: ["runOnceForAllItems", "runOnceForEachItem"], inputAccess: { allItems: "$input.all()", firstItem: "$input.first()", currentItem: "$input.item", json: "$json" } }, example: { mode: "runOnceForAllItems", jsCode: "return items.map(item => ({json: {...item.json, processed: true}}));" } },
    { name: "Set", type: "n8n-nodes-base.set", category: "Core", description: "데이터 필드 설정/변환 (Edit Fields)", isTrigger: false, essentials: { requiredParams: ["mode"], modes: ["manual", "raw"] }, example: { mode: "manual", assignments: { assignments: [{ name: "field", value: "={{ $json.input }}" }] } } },
    { name: "IF", type: "n8n-nodes-base.if", category: "Core", description: "조건 분기", isTrigger: false, essentials: { requiredParams: ["conditions"], conditionTypes: ["string", "number", "boolean", "dateTime"], stringOps: ["equals", "notEquals", "contains", "startsWith", "endsWith", "regex", "isEmpty"], combineConditions: ["and", "or"] }, example: { conditions: { conditions: [{ leftValue: "={{ $json.status }}", rightValue: "active", operator: { type: "string", operation: "equals" } }] } } },
    { name: "Switch", type: "n8n-nodes-base.switch", category: "Core", description: "다중 조건 분기", isTrigger: false, essentials: { requiredParams: ["mode"], modes: ["rules", "expression"] }, example: { mode: "rules", rules: { rules: [{ output: 0, conditions: { conditions: [{ leftValue: "={{ $json.type }}", rightValue: "A" }] } }] } } },
    { name: "Merge", type: "n8n-nodes-base.merge", category: "Core", description: "여러 입력을 하나로 합침", isTrigger: false, essentials: { requiredParams: ["mode"], modes: ["append", "combine", "chooseBranch"] }, example: { mode: "append" } },
    { name: "Split Out", type: "n8n-nodes-base.splitOut", category: "Core", description: "배열을 개별 아이템으로 분리", isTrigger: false, essentials: { requiredParams: ["fieldToSplitOut"] }, example: { fieldToSplitOut: "items" } },
    { name: "Aggregate", type: "n8n-nodes-base.aggregate", category: "Core", description: "여러 아이템을 하나로 집계", isTrigger: false, essentials: { requiredParams: ["aggregate"], aggregateTypes: ["aggregateIndividualFields", "aggregateAllItemData"] }, example: { aggregate: "aggregateAllItemData" } },
    { name: "Wait", type: "n8n-nodes-base.wait", category: "Core", description: "일정 시간 대기", isTrigger: false, essentials: { requiredParams: ["resume"], resumeTypes: ["timeInterval", "specificTime", "webhook"] }, example: { resume: "timeInterval", amount: 5, unit: "seconds" } },
    { name: "Respond to Webhook", type: "n8n-nodes-base.respondToWebhook", category: "Core", description: "Webhook 응답", isTrigger: false, essentials: { requiredParams: ["respondWith"], respondWith: ["allIncomingItems", "firstIncomingItem", "json", "noData", "text"] }, example: { respondWith: "json", responseCode: 200 } },
    { name: "Schedule Trigger", type: "n8n-nodes-base.scheduleTrigger", category: "Core", description: "정해진 시간에 트리거", isTrigger: true, essentials: { requiredParams: ["rule"], ruleTypes: ["interval", "cronExpression"] }, example: { rule: { interval: [{ field: "hours", hoursInterval: 1 }] } } },
    { name: "Manual Trigger", type: "n8n-nodes-base.manualTrigger", category: "Core", description: "수동 시작", isTrigger: true, essentials: { requiredParams: [] }, example: {} },
    { name: "Execute Workflow Trigger", type: "n8n-nodes-base.executeWorkflowTrigger", category: "Core", description: "Sub-workflow 트리거", isTrigger: true, essentials: { requiredParams: [], inputSource: ["passthrough", "define"] }, example: { inputSource: "passthrough" } },
    { name: "Execute Workflow", type: "n8n-nodes-base.executeWorkflow", category: "Core", description: "다른 워크플로우 실행", isTrigger: false, essentials: { requiredParams: ["source", "workflowId"], sources: ["database", "localFile", "parameter", "url"] }, example: { source: "database", workflowId: "your-workflow-id" } },
    { name: "Notion", type: "n8n-nodes-base.notion", category: "App", description: "Notion DB/페이지 관리", isTrigger: false, operations: ["append", "create", "get", "getAll", "update", "archive"], resources: ["block", "database", "databasePage", "page", "user"], essentials: { requiredParams: ["resource", "operation"], credentials: "notionApi" }, example: { resource: "databasePage", operation: "create", databaseId: "your-db-id" } },
    { name: "Google Drive", type: "n8n-nodes-base.googleDrive", category: "App", description: "Google Drive 파일 관리", isTrigger: false, operations: ["copy", "create", "delete", "download", "list", "move", "share", "update", "upload"], resources: ["drive", "file", "folder"], essentials: { requiredParams: ["resource", "operation"], credentials: "googleDriveOAuth2Api" }, example: { resource: "file", operation: "download", fileId: "your-file-id" } },
    { name: "Google Sheets", type: "n8n-nodes-base.googleSheets", category: "App", description: "Google Sheets 읽기/쓰기", isTrigger: false, operations: ["append", "appendOrUpdate", "clear", "create", "delete", "read", "update"], resources: ["sheet", "spreadsheet"], essentials: { requiredParams: ["resource", "operation", "documentId"], credentials: "googleSheetsOAuth2Api" }, example: { resource: "sheet", operation: "read", documentId: "your-spreadsheet-id" } },
    { name: "Slack", type: "n8n-nodes-base.slack", category: "App", description: "Slack 메시지 관리", isTrigger: false, operations: ["post", "update", "delete", "get", "getPermalink", "search"], resources: ["channel", "message", "reaction", "star", "file", "user"], essentials: { requiredParams: ["resource", "operation"], credentials: "slackApi" }, example: { resource: "message", operation: "post", channel: "C0A114X11C2", text: "Hello!" } },
    { name: "Gmail", type: "n8n-nodes-base.gmail", category: "App", description: "Gmail 이메일 관리", isTrigger: false, operations: ["send", "reply", "get", "getAll", "delete"], resources: ["draft", "label", "message", "thread"], essentials: { requiredParams: ["resource", "operation"], credentials: "gmailOAuth2" }, example: { resource: "message", operation: "send", to: "user@example.com" } },
    { name: "AI Agent", type: "@n8n/n8n-nodes-langchain.agent", category: "AI", description: "AI Agent 실행 (Tool Router)", isTrigger: false, essentials: { requiredParams: ["text"], optionalParams: ["systemMessage", "maxIterations"], connectedNodes: { ai_languageModel: "LLM 모델 (필수)", ai_tool: "Tool 노드들", ai_memory: "메모리 노드" } }, example: { text: "={{ $json.message }}", systemMessage: "당신은 전략팀장입니다." } },
    { name: "OpenAI Chat Model", type: "@n8n/n8n-nodes-langchain.lmChatOpenAi", category: "AI", description: "OpenAI GPT 모델", isTrigger: false, essentials: { requiredParams: ["model"], credentials: "openAiApi", models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"] }, example: { model: "gpt-4o", temperature: 0.7 } },
    { name: "Anthropic Chat Model", type: "@n8n/n8n-nodes-langchain.lmChatAnthropic", category: "AI", description: "Anthropic Claude 모델", isTrigger: false, essentials: { requiredParams: ["model"], credentials: "anthropicApi", models: ["claude-3-5-sonnet-20241022", "claude-3-opus-20240229"] }, example: { model: "claude-3-5-sonnet-20241022", temperature: 0.7 } },
    { name: "Google Gemini Chat Model", type: "@n8n/n8n-nodes-langchain.lmChatGoogleGemini", category: "AI", description: "Google Gemini 모델", isTrigger: false, essentials: { requiredParams: ["model"], credentials: "googlePalmApi", models: ["gemini-pro", "gemini-1.5-pro", "gemini-1.5-flash"] }, example: { model: "gemini-1.5-pro", temperature: 0.7 } },
    { name: "HTTP Request Tool", type: "@n8n/n8n-nodes-langchain.toolHttpRequest", category: "AI Tool", description: "AI Agent용 HTTP Request Tool", isTrigger: false, essentials: { requiredParams: ["method", "url", "description"] }, example: { name: "fetch_data", method: "GET", url: "https://api.example.com" } }
  ],
  aliases: {
    "웹훅": "Webhook", "webhook": "Webhook", "http": "HTTP Request", "api": "HTTP Request",
    "코드": "Code", "javascript": "Code", "python": "Code", "js": "Code",
    "set": "Set", "edit fields": "Set", "필드": "Set", "에딧필드": "Set",
    "if": "IF", "조건": "IF", "condition": "IF",
    "switch": "Switch", "분기": "Switch", "스위치": "Switch",
    "merge": "Merge", "합치기": "Merge", "머지": "Merge",
    "split": "Split Out", "분리": "Split Out", "스플릿": "Split Out",
    "aggregate": "Aggregate", "집계": "Aggregate", "어그리게이트": "Aggregate",
    "wait": "Wait", "대기": "Wait", "delay": "Wait",
    "respond": "Respond to Webhook", "응답": "Respond to Webhook",
    "노션": "Notion", "notion": "Notion",
    "구글드라이브": "Google Drive", "드라이브": "Google Drive", "drive": "Google Drive",
    "구글시트": "Google Sheets", "시트": "Google Sheets", "sheets": "Google Sheets", "스프레드시트": "Google Sheets",
    "슬랙": "Slack", "slack": "Slack",
    "지메일": "Gmail", "gmail": "Gmail", "이메일": "Gmail", "email": "Gmail",
    "ai agent": "AI Agent", "agent": "AI Agent", "에이전트": "AI Agent",
    "openai": "OpenAI Chat Model", "gpt": "OpenAI Chat Model", "chatgpt": "OpenAI Chat Model",
    "anthropic": "Anthropic Chat Model", "claude": "Anthropic Chat Model", "클로드": "Anthropic Chat Model",
    "gemini": "Google Gemini Chat Model", "제미나이": "Google Gemini Chat Model",
    "스케줄": "Schedule Trigger", "schedule": "Schedule Trigger", "cron": "Schedule Trigger", "예약": "Schedule Trigger",
    "manual": "Manual Trigger", "수동": "Manual Trigger",
    "subworkflow": "Execute Workflow", "서브워크플로우": "Execute Workflow", "하위워크플로우": "Execute Workflow"
  }
};

function searchNodes(query) {
  const q = query.toLowerCase().trim();
  const aliasMatch = NODES_DB.aliases[q];
  if (aliasMatch) {
    const node = NODES_DB.nodes.find(n => n.name === aliasMatch);
    if (node) return [node];
  }
  return NODES_DB.nodes.filter(node =>
    node.name.toLowerCase().includes(q) ||
    node.type.toLowerCase().includes(q) ||
    node.category.toLowerCase().includes(q) ||
    node.description.toLowerCase().includes(q)
  );
}

function getNodeByType(nodeType) {
  const normalized = nodeType.replace('n8n-nodes-base.', '').replace('@n8n/n8n-nodes-langchain.', '').toLowerCase();
  return NODES_DB.nodes.find(n =>
    n.type === nodeType ||
    n.type.toLowerCase().includes(normalized) ||
    n.name.toLowerCase() === normalized
  );
}

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
  { name: "change_user_role", description: "Change user role (Owner only)", inputSchema: { type: "object", properties: { userId: { type: "string" }, newRole: { type: "string" } }, required: ["userId", "newRole"] } },
  { name: "search_nodes", description: "n8n 노드 검색. 키워드로 노드명, 타입, 카테고리, 설명 검색. 한국어 지원 (예: 웹훅, 노션, 조건)", inputSchema: { type: "object", properties: { query: { type: "string", description: "검색 키워드 (예: webhook, notion, 조건, AI)" } }, required: ["query"] } },
  { name: "get_node_essentials", description: "특정 노드의 필수 파라미터, 설정 옵션, 예시 조회", inputSchema: { type: "object", properties: { nodeType: { type: "string", description: "노드 타입 (예: n8n-nodes-base.webhook, notion, IF)" } }, required: ["nodeType"] } },
  { name: "list_nodes", description: "전체 노드 목록을 카테고리별로 조회", inputSchema: { type: "object", properties: { category: { type: "string", description: "필터할 카테고리 (Core, App, AI, AI Tool). 생략시 전체" } } } }
];

async function handleTool(name, args) {
  console.log('TOOL:', name, JSON.stringify(args));
  const headers = { 'X-N8N-API-KEY': N8N_API_KEY, 'Content-Type': 'application/json' };
  
  if (name === 'search_nodes') {
    const results = searchNodes(args.query || '');
    if (results.length === 0) return { found: 0, message: `'${args.query}'에 해당하는 노드를 찾을 수 없습니다.`, availableCategories: ["Core", "App", "AI", "AI Tool"] };
    return { found: results.length, query: args.query, nodes: results.map(n => ({ name: n.name, type: n.type, category: n.category, description: n.description, isTrigger: n.isTrigger })) };
  }
  
  if (name === 'get_node_essentials') {
    const node = getNodeByType(args.nodeType);
    if (!node) return { error: `'${args.nodeType}' 노드를 찾을 수 없습니다.`, suggestion: "search_nodes로 먼저 검색해보세요." };
    return { name: node.name, type: node.type, category: node.category, description: node.description, isTrigger: node.isTrigger, operations: node.operations || [], resources: node.resources || [], essentials: node.essentials, example: node.example };
  }
  
  if (name === 'list_nodes') {
    let nodes = NODES_DB.nodes;
    if (args.category) nodes = nodes.filter(n => n.category.toLowerCase() === args.category.toLowerCase());
    const byCategory = {};
    nodes.forEach(n => {
      if (!byCategory[n.category]) byCategory[n.category] = [];
      byCategory[n.category].push({ name: n.name, type: n.type, isTrigger: n.isTrigger });
    });
    return { totalNodes: nodes.length, filter: args.category || "all", nodesByCategory: byCategory };
  }
  
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
  if (msg.method === 'initialize') response = { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'n8n-mcp', version: '2.1.0' } } };
  else if (msg.method === 'tools/list') { response = { jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } }; console.log('Tools:', TOOLS.length); }
  else if (msg.method === 'tools/call') { try { const result = await handleTool(msg.params.name, msg.params.arguments || {}); response = { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } }; } catch (e) { response = { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'Error: ' + (e.response?.data?.message || e.message) }], isError: true } }; } }
  else response = { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } };
  if (response) sseRes.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
  res.status(200).end();
});

app.get('/health', (req, res) => res.json({ status: 'ok', version: '2.1.0', tools: TOOLS.length, nodes: NODES_DB.nodes.length }));

app.listen(PORT, '0.0.0.0', () => console.log(`MCP Server v2.1.0 - ${TOOLS.length} tools (${NODES_DB.nodes.length} nodes) on port ${PORT}`));
