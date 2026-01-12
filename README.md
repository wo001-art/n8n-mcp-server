# n8n MCP Server

## MCP 엔드포인트
- **SSE**: https://n8n.wookvan.com/mcp/sse
- **OAuth Discovery**: https://n8n.wookvan.com/.well-known/oauth-authorization-server
- **Health**: https://n8n.wookvan.com/health

## 복구 방법
```bash
cd ~/n8n-mcp-server
git pull
sudo docker stop mcp-server && sudo docker rm mcp-server
sudo docker build -t mcp-server .
sudo docker run -d --name mcp-server -p 3000:3000 \
  -e N8N_API_BASE_URL=https://n8n.wookvan.com/api/v1 \
  -e N8N_API_KEY=(Notion 참조) \
  --restart unless-stopped mcp-server
```

## 환경변수
Notion "API 키 관리" 참조
- N8N_API_BASE_URL=https://n8n.wookvan.com/api/v1
- N8N_API_KEY=(Notion 참조)
- BASE_URL=https://n8n.wookvan.com
