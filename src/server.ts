#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { TigerCloudDB } from './database';
import { ProjectDetector } from './project-detector';
import { ToolHandler } from './tools/index';
import { createAuthModule, AuthModule } from './auth/index';
import { createLogger } from 'winston';
import * as dotenv from 'dotenv';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';

dotenv.config();

const logger = createLogger({
  level: process.env['LOG_LEVEL'] || 'info',
  format: require('winston').format.combine(
    require('winston').format.timestamp(),
    require('winston').format.json()
  ),
  transports: [
    new (require('winston').transports.Console)()
  ]
});

export class TigerMemoryServer {
  private server: Server;
  private database: TigerCloudDB;
  private toolHandler: ToolHandler;
  private currentProjectId?: string;
  private currentSessionId?: string;

  constructor() {
    this.server = new Server(
      {
        name: 'tigermemory',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.database = new TigerCloudDB();
    this.toolHandler = new ToolHandler(this.database);
    
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'remember_decision',
            description: 'Store an architectural decision with context and reasoning',
            inputSchema: {
              type: 'object',
              properties: {
                decision: {
                  type: 'string',
                  description: 'The architectural decision made'
                },
                reasoning: {
                  type: 'string',
                  description: 'The reasoning behind the decision'
                },
                type: {
                  type: 'string',
                  enum: ['tech_stack', 'architecture', 'pattern', 'tool_choice'],
                  description: 'The type of decision'
                },
                alternatives_considered: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Alternative options that were considered'
                },
                files_affected: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Files that were affected by this decision'
                },
                confidence: {
                  type: 'number',
                  minimum: 0,
                  maximum: 1,
                  description: 'Confidence level in the decision (0-1)'
                },
                public: {
                  type: 'boolean',
                  description: 'Whether this decision can be shared publicly for pattern learning'
                }
              },
              required: ['decision', 'reasoning', 'type', 'confidence', 'public']
            }
          },
          {
            name: 'recall_context',
            description: 'Retrieve project context and previous decisions',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Optional semantic search query'
                },
                limit: {
                  type: 'number',
                  default: 10,
                  description: 'Maximum number of decisions to retrieve'
                }
              }
            }
          },
          {
            name: 'discover_patterns',
            description: 'Search for architectural patterns from similar projects',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query for architectural patterns'
                },
                tech_stack: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Filter by technology stack'
                },
                project_type: {
                  type: 'string',
                  description: 'Filter by project type'
                }
              },
              required: ['query']
            }
          },
          {
            name: 'get_timeline',
            description: 'Get chronological timeline of project decisions',
            inputSchema: {
              type: 'object',
              properties: {
                since: {
                  type: 'string',
                  format: 'date-time',
                  description: 'Get decisions since this date'
                },
                category: {
                  type: 'string',
                  enum: ['tech_stack', 'architecture', 'pattern', 'tool_choice'],
                  description: 'Filter by decision category'
                }
              }
            }
          }
        ]
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        await this.ensureProjectContext();

        switch (name) {
          case 'remember_decision':
            return await this.toolHandler.handleRememberDecision(
              args,
              this.currentProjectId!,
              this.currentSessionId!,
              undefined // Local server doesn't have user authentication yet
            );

          case 'recall_context':
            return await this.toolHandler.handleRecallContext(
              args,
              this.currentProjectId!
            );

          case 'discover_patterns':
            return await this.toolHandler.handleDiscoverPatterns(args);

          case 'get_timeline':
            return await this.toolHandler.handleGetTimeline(
              args,
              this.currentProjectId!
            );

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        logger.error('Tool execution error', { name, error });
        
        if (error instanceof McpError) {
          throw error;
        }
        
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    });
  }

  private async ensureProjectContext(): Promise<void> {
    if (this.currentProjectId && this.currentSessionId) {
      return;
    }

    try {
      const projectInfo = await ProjectDetector.detectProject();
      if (!projectInfo) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          'Cannot detect project. Please run tigermemory init in a project directory.'
        );
      }

      const project = await this.database.getOrCreateProject({
        name: projectInfo.name,
        pathHash: projectInfo.pathHash,
        ...(projectInfo.repositoryId && { repositoryId: projectInfo.repositoryId }),
        ...(projectInfo.gitRemoteUrl && { gitRemoteUrl: projectInfo.gitRemoteUrl }),
        techStack: projectInfo.techStack,
        projectType: projectInfo.projectType
      });

      const session = await this.database.createSession(project.id!);
      
      this.currentProjectId = project.id!;
      this.currentSessionId = session.id!;
      
      logger.info('Project context established', {
        projectId: this.currentProjectId,
        sessionId: this.currentSessionId,
        projectName: project.name
      });
    } catch (error) {
      logger.error('Failed to establish project context', error);
      throw error;
    }
  }

  async start(): Promise<void> {
    try {
      await this.database.connect();
      
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      
      logger.info('Tiger Memory MCP server started');
      
      process.on('SIGINT', async () => {
        logger.info('Shutting down Tiger Memory server...');
        await this.database.disconnect();
        process.exit(0);
      });
      
    } catch (error) {
      logger.error('Failed to start server', error);
      process.exit(1);
    }
  }
}

// Remote MCP server for Render deployment using SSE transport
export class TigerMemoryRemoteServer {
  private port: number;
  private server: Server;
  private database: TigerCloudDB;
  private toolHandler: ToolHandler;
  private auth: AuthModule;
  private app: express.Application;
  private httpServer: any;
  private transports: Map<string, SSEServerTransport> = new Map();
  private sessions: Map<string, { userId: string; username: string }> = new Map();
  private currentUserId: string | undefined;

  constructor() {
    this.port = parseInt(process.env['PORT'] || '10000');
    this.server = new Server(
      {
        name: 'tigermemory-remote',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.database = new TigerCloudDB();
    this.toolHandler = new ToolHandler(this.database);
    this.auth = createAuthModule(this.database);
    this.app = express();
    
    // CRITICAL: Set up MCP message endpoint FIRST, before any middleware that might consume the stream
    this.setupMCPMessageEndpoint();
    this.setupExpress();
    this.setupMCPHandlers();
    this.setupHTTPServer();
  }

  private setupMCPMessageEndpoint(): void {
    // MCP message endpoint - NO middleware, raw stream access for SSEServerTransport
    this.app.post('/mcp/message', async (req: express.Request, res: express.Response) => {
      const sessionId = req.query['sessionId'] as string;
      
      // Check session-based authentication (from SSE connection)
      const session = this.sessions.get(sessionId);
      if (!session) {
        res.status(401).json({ error: 'Invalid session - please reconnect' });
        return;
      }
      
      const transport = this.transports.get(sessionId);
      if (!transport) {
        res.status(404).json({ error: 'Transport not found' });
        return;
      }

      try {
        // Set current user context for this session/transport
        this.currentUserId = session.userId;
        
        logger.info('MCP message processing', { 
          sessionId, 
          userId: session.userId, 
          username: session.username,
          currentUserId: this.currentUserId
        });
        
        await transport.handlePostMessage(req, res);
        
        // Clear user context after handling
        this.currentUserId = undefined;
      } catch (error) {
        logger.error('Error handling MCP message', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });
  }

  private setupMCPHandlers(): void {
    // Same MCP handlers as the local server
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'remember_decision',
            description: 'Store an architectural decision with context and reasoning',
            inputSchema: {
              type: 'object',
              properties: {
                decision: { type: 'string', description: 'The architectural decision made' },
                reasoning: { type: 'string', description: 'The reasoning behind the decision' },
                type: {
                  type: 'string',
                  enum: ['tech_stack', 'architecture', 'pattern', 'tool_choice'],
                  description: 'The type of decision'
                },
                alternatives_considered: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Alternative options that were considered'
                },
                files_affected: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Files that were affected by this decision'
                },
                confidence: {
                  type: 'number',
                  minimum: 0,
                  maximum: 1,
                  description: 'Confidence level in the decision (0-1)'
                },
                public: {
                  type: 'boolean',
                  description: 'Whether this decision can be shared publicly for pattern learning'
                }
              },
              required: ['decision', 'reasoning', 'type', 'confidence', 'public']
            }
          },
          {
            name: 'recall_context',
            description: 'Retrieve project context and previous decisions',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Optional semantic search query' },
                limit: { type: 'number', default: 10, description: 'Maximum number of decisions to retrieve' }
              }
            }
          },
          {
            name: 'discover_patterns',
            description: 'Search for architectural patterns from similar projects',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Search query for architectural patterns' },
                tech_stack: { type: 'array', items: { type: 'string' }, description: 'Filter by technology stack' },
                project_type: { type: 'string', description: 'Filter by project type' }
              },
              required: ['query']
            }
          },
          {
            name: 'get_timeline',
            description: 'Get chronological timeline of project decisions',
            inputSchema: {
              type: 'object',
              properties: {
                since: { type: 'string', format: 'date-time', description: 'Get decisions since this date' },
                category: {
                  type: 'string',
                  enum: ['tech_stack', 'architecture', 'pattern', 'tool_choice'],
                  description: 'Filter by decision category'
                }
              }
            }
          }
        ]
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        await this.ensureProjectContext();

        // Use currentUserId set during message processing
        const userId = this.currentUserId;

        logger.info('Tool request received - CURRENT USER VERSION', {
          toolName: name,
          userId: userId,
          currentUserId: this.currentUserId,
          version: 'current-user-fix-v3'
        });

        // Extract project context from tool arguments (passed by remote client)
        const projectContext = args?.['_projectContext'] as any;
        let projectInfo;
        
        if (projectContext && projectContext.pathHash) {
          // Use actual project context from client
          projectInfo = {
            name: projectContext.name || 'unknown-project',
            pathHash: projectContext.pathHash,
            repositoryId: projectContext.repositoryId,
            gitRemoteUrl: projectContext.gitRemoteUrl,
            techStack: projectContext.techStack || ['unknown'],
            projectType: projectContext.projectType || 'general'
          };
        } else {
          // Fallback for legacy clients or missing context
          logger.warn('No project context provided, using fallback');
          projectInfo = { 
            name: 'remote-fallback', 
            pathHash: `fallback-${userId}-${Date.now()}`,
            repositoryId: undefined,
            gitRemoteUrl: undefined,
            techStack: ['unknown'],
            projectType: 'general'
          };
        }
        
        const project = await this.database.getOrCreateProject({
          name: projectInfo.name,
          pathHash: projectInfo.pathHash,
          ...(projectInfo.repositoryId && { repositoryId: projectInfo.repositoryId }),
          ...(projectInfo.gitRemoteUrl && { gitRemoteUrl: projectInfo.gitRemoteUrl }),
          techStack: projectInfo.techStack,
          projectType: projectInfo.projectType
        });

        const session = await this.database.createSession(project.id!);

        // Remove internal project context from arguments before passing to tools
        const cleanArguments = { ...args };
        delete cleanArguments['_projectContext'];

        switch (name) {
          case 'remember_decision':
            logger.info('Calling handleRememberDecision', { 
              toolName: name,
              projectId: project.id,
              sessionId: session.id,
              userId: userId 
            });
            return await this.toolHandler.handleRememberDecision(cleanArguments, project.id!, session.id!, userId);
          case 'recall_context':
            return await this.toolHandler.handleRecallContext(cleanArguments, project.id!);
          case 'discover_patterns':
            return await this.toolHandler.handleDiscoverPatterns(cleanArguments);
          case 'get_timeline':
            return await this.toolHandler.handleGetTimeline(cleanArguments, project.id!);
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        logger.error('Tool execution error', { name, error });
        if (error instanceof McpError) throw error;
        throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    });
  }

  private async ensureProjectContext(): Promise<void> {
    // Simplified for remote server - you might want more sophisticated project detection
  }

  private setupExpress(): void {
    // IMPORTANT: NO body parsing middleware for /mcp/message - SSEServerTransport handles raw body itself
    
    // General middleware (but NOT for /mcp/message)
    this.app.use((req, res, next) => {
      if (req.path === '/mcp/message') {
        // Skip body parsing for MCP message endpoint
        return next();
      }
      express.json()(req, res, next);
    });
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(cookieParser());
    
    // CORS
    this.app.use((req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
      }
      next();
    });
    
    // Auth middleware for API routes
    this.app.use('/api', (req: express.Request, res: express.Response, next: express.NextFunction) => this.auth.middleware.extractUser(req as any, res, next));
    
    // Auth middleware for MCP SSE endpoint only (message endpoint uses session-based auth)
    this.app.use('/mcp/sse', (req: express.Request, res: express.Response, next: express.NextFunction) => this.auth.middleware.extractUser(req as any, res, next));
    
    // Auth routes
    this.app.use('/auth', this.auth.routes);
    
    // Static file serving for landing page
    this.app.use(express.static(path.join(process.cwd(), 'www')));
    
    // MCP SSE endpoint
    this.app.get('/mcp/sse', async (req: express.Request, res: express.Response) => {
      // Extract user from auth middleware (should be available from earlier middleware)
      const user = (req as any).user;
      
      if (!user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      
      logger.info('Starting MCP SSE connection', { userId: user.id, username: user.username });
      
      const transport = new SSEServerTransport('/mcp/message', res);
      this.transports.set(transport.sessionId, transport);
      
      // Store user session for message endpoint authentication
      this.sessions.set(transport.sessionId, {
        userId: user.id,
        username: user.username
      });
      
      transport.onclose = () => {
        this.transports.delete(transport.sessionId);
        this.sessions.delete(transport.sessionId);
        logger.info('MCP SSE connection closed', { sessionId: transport.sessionId });
      };

      try {
        logger.info('Attempting to connect MCP server to SSE transport', { sessionId: transport.sessionId });
        await this.server.connect(transport);
        logger.info('MCP server connected to SSE transport successfully', { sessionId: transport.sessionId });
      } catch (error) {
        logger.error('Failed to connect MCP server to SSE transport', { 
          sessionId: transport.sessionId, 
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined
        });
        res.status(500).json({ error: 'Failed to establish MCP connection' });
        return;
      }
    });
    
    
    // API health check
    this.app.get('/api/health', (_req: express.Request, res: express.Response) => {
      res.json({
        service: 'Tiger Memory Remote MCP Server',
        version: '1.0.0',
        status: 'running',
        transport: 'sse',
        mcp_tools: ['remember_decision', 'recall_context', 'discover_patterns', 'get_timeline'],
        endpoints: {
          connect: '/mcp/sse',
          message: '/mcp/message',
          auth: '/auth/github'
        }
      });
    });
    
    // Root serves landing page (handled by static middleware above)
  }

  private setupHTTPServer(): void {
    const http = require('http');
    this.httpServer = http.createServer(this.app);
  }

  async start(): Promise<void> {
    try {
      await this.database.connect();
      
      this.httpServer.listen(this.port, () => {
        logger.info(`Tiger Memory Remote MCP Server running on port ${this.port}`);
        console.log(`🐅 Tiger Memory Remote MCP Server`);
        console.log(`🌐 Health Check: http://localhost:${this.port}/`);
        console.log(`📡 MCP SSE Endpoint: http://localhost:${this.port}/mcp/sse`);
        console.log(`📬 MCP Message Endpoint: http://localhost:${this.port}/mcp/message`);
      });
      
    } catch (error) {
      logger.error('Failed to start remote server', error);
      process.exit(1);
    }
  }
}

if (require.main === module) {
  // Check if we're running in remote mode (PORT env var set) or local MCP mode
  if (process.env['PORT']) {
    const remoteServer = new TigerMemoryRemoteServer();
    remoteServer.start().catch((error) => {
      console.error('Remote MCP server startup failed:', error);
      process.exit(1);
    });
  } else {
    const server = new TigerMemoryServer();
    server.start().catch((error) => {
      console.error('Local MCP server startup failed:', error);
      process.exit(1);
    });
  }
}