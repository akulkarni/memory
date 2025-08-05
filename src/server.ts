#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { TigerCloudDB } from './database.js';
import { ProjectDetector } from './project-detector.js';
import { ToolHandler } from './tools/index.js';
import { createLogger } from 'winston';
import * as dotenv from 'dotenv';

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
              this.currentSessionId!
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

      let project = await this.database.getProject(projectInfo.pathHash);
      if (!project) {
        project = await this.database.createProject({
          name: projectInfo.name,
          path_hash: projectInfo.pathHash,
          tech_stack: projectInfo.techStack,
          project_type: projectInfo.projectType
        });
        logger.info('Created new project', { project });
      }

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

if (require.main === module) {
  const server = new TigerMemoryServer();
  server.start().catch((error) => {
    console.error('Server startup failed:', error);
    process.exit(1);
  });
}