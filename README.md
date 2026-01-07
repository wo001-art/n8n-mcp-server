# n8n MCP Server

## 복구 방법
```bash
cd ~/n8n-mcp-server
sudo docker build -t mcp-server .
sudo docker run -d --name mcp-server -p 3000:3000 --restart unless-stopped mcp-server
```

## 환경변수
Notion "API 키 관리" 참조
- N8N_API_BASE_URL=https://n8n.wookvan.com/api/v1
- N8N_API_KEY=(Notion 참조)
- BASE_URL=https://n8n.wookvan.com
