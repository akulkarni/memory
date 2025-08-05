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
- **🌐 Cloud-Native** - Direct connection to Tiger Cloud PostgreSQL database
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

2. **Set environment variables:**
   ```bash
   export TIGER_CLOUD_CONNECTION_STRING="postgresql://..."
   export ANTHROPIC_API_KEY="sk-ant-..."
   ```

3. **Set up the database:**
   ```bash
   tigermemory migrate
   ```

4. **Initialize Tiger Memory:**
   ```bash
   tigermemory init
   ```

5. **Restart Claude Code** to load the new MCP server

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
         you wanted to use Prisma for the ORM and implement user roles. 
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

Tiger Memory uses a cloud-native architecture:

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Claude Code   │───▶│  Tiger Memory    │───▶│  Tiger Cloud    │
│                 │    │  MCP Server      │    │  PostgreSQL     │
│  - remember     │    │                  │    │  + TimescaleDB  │
│  - recall       │    │  - Project       │    │  + pgvector     │
│  - discover     │    │    Detection     │    │                 │
│  - timeline     │    │  - Vector        │    │  - Projects     │
│                 │    │    Embeddings    │    │  - Decisions    │
│                 │    │  - Intelligence  │    │  - Patterns     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## 📖 CLI Commands

### `tigermemory migrate`
Set up the database schema for Tiger Memory.

```bash
tigermemory migrate
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
| `TIGER_CLOUD_CONNECTION_STRING` | Yes | PostgreSQL connection string for Tiger Cloud |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for vector embeddings |
| `LOG_LEVEL` | No | Logging level (`debug`, `info`, `warn`, `error`) |
| `NODE_ENV` | No | Environment (`development`, `production`) |

### MCP Configuration

Tiger Memory automatically creates `.claude_mcp_config.json`:

```json
{
  "mcpServers": {
    "tigermemory": {
      "command": "npx",
      "args": ["tigermemory", "server"],
      "env": {
        "TIGER_CLOUD_CONNECTION_STRING": "postgresql://...",
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

## 🔒 Privacy & Security

- **You control sharing**: Decisions marked `public: false` stay private to your project
- **No credentials stored**: Environment variables handle sensitive data
- **Secure connections**: All database connections use SSL/TLS
- **Data isolation**: Each project gets a unique hash-based identifier
- **Audit trail**: Complete timeline of all decisions and changes

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

- [ ] **Team Collaboration** - Share project memories across team members
- [ ] **Pattern Marketplace** - Community-driven architectural pattern sharing
- [ ] **IDE Extensions** - Direct integration with VS Code, IntelliJ, etc.
- [ ] **Advanced Analytics** - Decision success tracking and recommendations
- [ ] **Multi-LLM Support** - Support for other AI coding assistants
- [ ] **Self-Hosted Option** - Run your own Tiger Cloud instance

---

**Tiger Memory** - Making Claude Code remember, so you don't have to repeat yourself.

*Built with ❤️ for the developer community*