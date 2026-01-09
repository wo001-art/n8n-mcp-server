# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an n8n MCP (Model Context Protocol) Server that enables Claude and other AI assistants to interact with n8n workflow automation platform. It provides OAuth 2.0 authentication and exposes 35+ tools for managing n8n workflows, executions, credentials, tags, and users.

## Build and Run Commands

```bash
# Install dependencies
npm install

# Start the server
npm start

# Docker build and run
docker build -t mcp-server .
docker run -d --name mcp-server -p 3000:3000 --restart unless-stopped mcp-server
```

## Environment Variables

- `N8N_API_BASE_URL` - n8n API endpoint (e.g., `https://n8n.example.com/api/v1`)
- `N8N_API_KEY` - n8n API key for authentication
- `BASE_URL` - Public URL of this MCP server (used for OAuth redirects)
- `PORT` - Server port (default: 3000)

## Architecture

This is a single-file Express.js application (`index.js`) with three main components:

### 1. OAuth 2.0 Server
- Endpoints: `/.well-known/oauth-authorization-server`, `/oauth/register`, `/oauth/authorize`, `/oauth/consent`, `/oauth/token`
- Supports PKCE (S256 and plain methods)
- In-memory storage for clients and auth codes (`db` object)

### 2. MCP Protocol Handler (SSE-based)
- `GET /mcp/sse` - Establishes SSE connection, returns message endpoint URL
- `POST /mcp/message` - Handles JSON-RPC messages (`initialize`, `tools/list`, `tools/call`)
- Sessions stored in `sessions` Map

### 3. n8n Node Database (`NODES_DB`)
- Built-in catalog of common n8n nodes with their parameters, examples, and Korean aliases
- Categories: Core, App, AI, AI Tool
- `searchNodes()` - Search by name, type, category, or description (supports Korean)
- `getNodeByType()` - Get node details by type identifier

## Key Tools

The `TOOLS` array defines all MCP tools. Main categories:
- **Workflow management**: search, get, create, update, delete, activate/deactivate, execute
- **Execution history**: get_executions, get_execution, delete_execution, retry_execution
- **Credentials**: list_credentials, create_credential, get_credential_schema, delete_credential
- **Tags**: list_tags, create_tag, get_tag, update_tag, delete_tag
- **Users**: list_users, get_user, create_user, delete_user, change_user_role (Owner only)
- **Node info**: search_nodes, get_node_essentials, list_nodes

## Health Check

`GET /health` - Returns server status, version, tool count, and node count
