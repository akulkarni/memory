# 🐅 Tiger Memory

**Claude Code that actually remembers your project**

Tiger Memory is a persistent memory system for Claude Code that provides architectural intelligence. It solves the context loss problem by automatically capturing and retrieving project decisions between sessions, evolving into a social architectural intelligence platform where developers learn from patterns across similar projects.

[![npm version](https://badge.fury.io/js/tigermemory.svg)](https://badge.fury.io/js/tigermemory)
[![TypeScript](https://img.shields.io/badge/TypeScript-4.5+-blue.svg)](https://www.typescriptlang.org/)

## ✨ Features

- **🧠 Automatic Decision Capture** - Claude automatically stores architectural decisions and reasoning
- **🔍 Intelligent Context Retrieval** - Semantic search through project history using vector embeddings
- **🏛️ Architectural Intelligence** - Discover patterns from similar projects in the community
- **📊 Project Timeline** - Track architectural evolution over time
- **⚡ Zero Manual Work** - Fully automatic integration with Claude Code via MCP
- **🌐 Cloud-Native** - Remote MCP server with SSE transport for seamless Claude Code integration
- **👥 Multi-User Support** - GitHub OAuth authentication with team collaboration
- **🔒 Privacy-First** - You control what decisions are shared publicly

## 🚀 Quick Start

### Installation

```bash
npm install -g tigermemory
```

### Setup

1. **Navigate to your project directory:**
   ```bash
   cd /your/project
   ```

2. **Authenticate with GitHub:**
   ```bash
   tigermemory login
   ```
   This opens your browser for GitHub OAuth authentication.

3. **Initialize Tiger Memory:**
   ```bash
   tigermemory init
   ```

4. **Restart Claude Code** to load the new MCP server

That's it! Tiger Memory will now automatically capture and recall your project decisions.

## 🎯 The Magic Moment

### Before Tiger Memory:
```
You: "Continue with our task app"
Claude: "I'd be happy to help, but I don't have context about your task app. 
         Could you tell me about your current setup, tech stack, and what 
         you're working on?"
```

### After Tiger Memory:
```
You: "Continue with our task app"
Claude: "I can see we're building a Node.js task management app with Express, 
         PostgreSQL, and JWT authentication. Based on our previous decisions, 
         you wanted to implement user roles with a clean database abstraction layer. 
         Should we continue with the task CRUD endpoints we discussed?"
```

## 🛠️ How It Works

Tiger Memory operates through four core MCP tools that Claude Code uses automatically:

### 1. `remember_decision` 
Automatically called when Claude makes architectural choices:

```typescript
{
  decision: "Use Express.js for the web framework",
  reasoning: "Express provides flexibility and has excellent middleware ecosystem",
  type: "tech_stack",
  alternatives_considered: ["Fastify", "Koa", "NestJS"],
  files_affected: ["package.json", "src/server.js"],
  confidence: 0.9,
  public: true
}
```

### 2. `recall_context`
Retrieves project context with semantic search:

```typescript
// Get all recent decisions
await recall_context({ limit: 10 })

// Semantic search
await recall_context({ 
  query: "authentication decisions",
  limit: 5 
})
```

### 3. `discover_patterns`
Find architectural patterns from similar projects:

```typescript
await discover_patterns({
  query: "user authentication patterns",
  tech_stack: ["nodejs", "express"],
  project_type: "backend"
})
```

### 4. `get_timeline`
View chronological decision history:

```typescript
// All decisions
await get_timeline({})

// Filtered by date and category
await get_timeline({
  since: "2024-01-01",
  category: "architecture"
})
```

## 📋 Supported Project Types

Tiger Memory automatically detects projects using:

- **Node.js** - `package.json`
- **Python** - `pyproject.toml`, `requirements.txt`, `setup.py`
- **Rust** - `Cargo.toml`
- **Go** - `go.mod`
- **Java** - `pom.xml`, `build.gradle`
- **PHP** - `composer.json`
- **Ruby** - `Gemfile`
- **Elixir** - `mix.exs`
- **Deno** - `deno.json`
- **Git repositories** - `.git` directory

## 🗄️ Architecture

Tiger Memory uses a cloud-native remote MCP architecture:

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Claude Code   │───▶│  Tiger Memory    │───▶│  Tiger Cloud    │
│                 │    │  Remote MCP      │    │  PostgreSQL     │
│  - remember     │    │  Server (SSE)    │    │  + TimescaleDB  │
│  - recall       │    │                  │    │  + pgvector     │
│  - discover     │    │  - GitHub OAuth  │    │                 │
│  - timeline     │    │  - User Context  │    │  - Users        │
│                 │    │  - Vector        │    │  - Teams        │
│                 │    │    Embeddings    │    │  - Projects     │
│                 │    │  - Intelligence  │    │  - Decisions    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## 📖 CLI Commands

### `tigermemory login`
Authenticate with GitHub to access Tiger Memory.

```bash
tigermemory login           # Login to hosted service
tigermemory login --local   # Login to local development instance
```

### `tigermemory init`
Initialize Tiger Memory for the current project.

```bash
tigermemory init [options]

Options:
  -f, --force    Force initialization even if already configured
```

### `tigermemory status`
Check Tiger Memory status for the current project.

```bash
tigermemory status
```

### `tigermemory server`
Start the MCP server (used internally by Claude Code).

```bash
tigermemory server
```

### `tigermemory reset`
Reset Tiger Memory configuration.

```bash
tigermemory reset --confirm
```

## ⚙️ Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for vector embeddings (development only) |
| `LOG_LEVEL` | No | Logging level (`debug`, `info`, `warn`, `error`) |
| `NODE_ENV` | No | Environment (`development`, `production`) |

> **Note**: For the hosted service, authentication is handled via GitHub OAuth. Environment variables are only needed for local development.

### MCP Configuration

Tiger Memory automatically creates `.claude_mcp_config.json` for remote MCP connection:

```json
{
  "mcpServers": {
    "tigermemory": {
      "command": "npx",
      "args": ["tigermemory", "server"],
      "env": {}
    }
  }
}
```

The remote server connection is established automatically using your authenticated session.

## 🔒 Privacy & Security

- **GitHub OAuth Authentication**: Secure authentication via GitHub with proper scope handling
- **You control sharing**: Decisions marked `public: false` stay private to your project
- **Secure API keys**: Authentication tokens stored locally and transmitted securely
- **Secure connections**: All connections use HTTPS/WSS with proper encryption
- **Data isolation**: User-based access control with team collaboration support
- **Audit trail**: Complete timeline of all decisions with user attribution

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup

```bash
# Clone the repository
git clone https://github.com/tigermemory/tigermemory.git
cd tigermemory

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your credentials

# Run in development mode
npm run dev

# Run tests
npm test

# Build for production
npm run build
```


## 🙋‍♀️ Support

- **Documentation**: [Tiger Memory Docs](https://docs.tigermemory.com)
- **Issues**: [GitHub Issues](https://github.com/tigermemory/tigermemory/issues)
- **Discussions**: [GitHub Discussions](https://github.com/tigermemory/tigermemory/discussions)
- **Email**: support@tigermemory.com

## 🗺️ Roadmap

- [x] **Multi-User Support** - GitHub OAuth authentication with user attribution
- [x] **Remote MCP Server** - Cloud-native SSE transport for seamless integration
- [ ] **Team Collaboration** - Enhanced team features and project sharing
- [ ] **Pattern Marketplace** - Community-driven architectural pattern sharing
- [ ] **IDE Extensions** - Direct integration with VS Code, IntelliJ, etc.
- [ ] **Advanced Analytics** - Decision success tracking and recommendations
- [ ] **Multi-LLM Support** - Support for other AI coding assistants
- [ ] **Self-Hosted Option** - Run your own Tiger Cloud instance

---

**Tiger Memory** - Making Claude Code remember, so you don't have to repeat yourself.

*Built with ❤️ for the developer community*