# Contributing to Tiger Memory

Thank you for your interest in contributing to Tiger Memory! This document provides guidelines and instructions for contributing.

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18.0.0 or higher
- **npm** or **yarn**
- **PostgreSQL** database access (for testing)
- **OpenAI API key** (for embedding tests)

### Development Setup

1. **Fork and clone the repository:**
   ```bash
   git clone https://github.com/your-username/tigermemory.git
   cd tigermemory
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

4. **Build the project:**
   ```bash
   npm run build
   ```

5. **Run tests:**
   ```bash
   npm test
   ```

## 🛠️ Development Workflow

### Code Structure

```
src/
├── server.ts           # Main MCP server
├── database.ts         # Tiger Cloud connection
├── project-detector.ts # Project identification
├── intelligence.ts     # AI/ML components
├── logger.ts          # Centralized logging
├── cli.ts             # Command line interface
└── tools/             # MCP tool handlers
    └── index.ts
```

### Key Components

- **MCP Server** (`server.ts`) - Handles MCP protocol communication
- **Database Layer** (`database.ts`) - PostgreSQL operations with pgvector
- **Project Detection** (`project-detector.ts`) - Identifies project types and tech stacks
- **AI Intelligence** (`intelligence.ts`) - OpenAI integration and pattern analysis
- **Tool Handlers** (`tools/index.ts`) - Implementation of MCP tools

### Development Commands

```bash
npm run dev        # Development mode with hot reload
npm run build      # Production build
npm run test       # Run Jest tests
npm run lint       # Run ESLint
npm run start      # Start production server
```

## 🧪 Testing

### Running Tests

```bash
# All tests
npm test

# Watch mode for development
npm run test:watch

# Coverage report
npm run test:coverage
```

### Writing Tests

- Place tests in `src/__tests__/` directory
- Use descriptive test names
- Mock external dependencies (database, OpenAI API)
- Aim for high test coverage on core functionality

Example test structure:
```typescript
describe('ComponentName', () => {
  beforeEach(() => {
    // Setup
  });

  it('should do something specific', () => {
    // Test implementation
  });
});
```

## 📝 Code Style

### TypeScript Guidelines

- Use strict TypeScript configuration
- Prefer explicit types over `any`
- Use meaningful variable and function names
- Include proper error handling

### Code Formatting

- Use 2 spaces for indentation
- Max line length: 100 characters
- Use semicolons
- Use single quotes for strings
- Follow existing patterns in the codebase

### Error Handling

- Use the centralized `TigerMemoryError` class
- Include context in error messages
- Log errors appropriately
- Handle edge cases gracefully

Example:
```typescript
try {
  await riskyOperation();
} catch (error) {
  throw new TigerMemoryError(
    'Operation failed',
    errorCodes.OPERATION_FAILED,
    500,
    { originalError: error }
  );
}
```

## 🚀 Contributing Process

### 1. Issue First

- Check existing issues before creating new ones
- Use issue templates when available
- Provide clear reproduction steps for bugs
- Include relevant environment information

### 2. Fork & Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/bug-description
```

### 3. Development

- Write clean, well-documented code
- Add tests for new functionality
- Update documentation as needed
- Ensure all tests pass

### 4. Commit Messages

Use conventional commit format:
```
type(scope): description

[optional body]

[optional footer]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `test`: Tests
- `refactor`: Code refactoring
- `chore`: Maintenance

Examples:
```bash
feat(database): add vector similarity search
fix(cli): handle missing environment variables
docs(readme): update installation instructions
```

### 5. Pull Request

- Fill out the PR template completely
- Link related issues
- Include screenshots for UI changes
- Ensure CI passes
- Request review from maintainers

## 🎯 Contribution Areas

### High Priority

- **Performance optimizations** - Database query optimization, caching
- **Error handling** - More robust error recovery
- **Testing** - Increase test coverage, integration tests
- **Documentation** - API docs, usage examples

### Medium Priority

- **New integrations** - Support for more project types
- **CLI improvements** - Better UX, more commands
- **Security** - Input validation, secure defaults
- **Monitoring** - Better logging, metrics

### Future Features

- **Team collaboration** - Multi-user support
- **Pattern marketplace** - Community patterns
- **IDE extensions** - VS Code, IntelliJ integration
- **Analytics** - Usage insights, recommendations

## 🐛 Bug Reports

Include:
- Tiger Memory version
- Node.js version
- Operating system
- Clear reproduction steps
- Expected vs actual behavior
- Relevant logs/error messages

## 💡 Feature Requests

Include:
- Clear use case description
- Why this feature is valuable
- Proposed implementation approach
- Willingness to contribute

## 📖 Documentation

- Update README for user-facing changes
- Add inline code comments for complex logic
- Update CLI help text for new commands
- Include examples in documentation

## 🏆 Recognition

Contributors will be:
- Listed in the project's CONTRIBUTORS.md
- Mentioned in release notes
- Given appropriate attribution

## 📬 Getting Help

- **GitHub Discussions** - For questions and ideas
- **GitHub Issues** - For bugs and feature requests
- **Discord** - For real-time chat (link coming soon)

## 📜 Code of Conduct

We're committed to providing a welcoming and inclusive environment for all contributors.

## 🔒 Security

For security issues, please email security@tigermemory.com instead of creating a public issue.

---

Thank you for contributing to Tiger Memory! 🐅