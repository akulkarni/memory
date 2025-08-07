#!/usr/bin/env node

// Add EventSource polyfill for Node.js
const { EventSource } = require('eventsource');
if (typeof global !== 'undefined' && !(global as any).EventSource) {
  (global as any).EventSource = EventSource;
}

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { 
  CallToolRequestSchema, 
  ListToolsRequestSchema,
  ErrorCode,
  McpError 
} from '@modelcontextprotocol/sdk/types.js';
import { createLogger } from 'winston';
import * as dotenv from 'dotenv';
import { AuthManager } from './cli/auth.js';
import { ProjectDetector } from './project-detector.js';
import { createHash } from 'crypto';
import * as path from 'path';

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

export class TigerMemoryRemoteClient {
  private server: Server;
  private client: Client;
  private remoteUrl: string;
  private auth: AuthManager;
  private projectContext?: { 
    name: string; 
    pathHash: string; 
    repositoryId?: string;
    gitRemoteUrl?: string;
    techStack: string[]; 
    projectType: string 
  };

  constructor() {
    this.remoteUrl = process.env['TIGER_REMOTE_URL'] || 'https://tigermemory.dev';
    this.auth = new AuthManager();
    
    this.server = new Server(
      {
        name: 'tigermemory-remote-client',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.client = new Client(
      {
        name: 'tigermemory-remote-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );

    this.setupHandlers();
  }

  private async ensureProjectContext(): Promise<void> {
    if (this.projectContext) {
      return;
    }

    try {
      const projectInfo = await ProjectDetector.detectProject();
      if (projectInfo) {
        this.projectContext = {
          name: projectInfo.name,
          pathHash: projectInfo.pathHash,
          ...(projectInfo.repositoryId && { repositoryId: projectInfo.repositoryId }),
          ...(projectInfo.gitRemoteUrl && { gitRemoteUrl: projectInfo.gitRemoteUrl }),
          techStack: projectInfo.techStack,
          projectType: projectInfo.projectType
        };
        logger.info('Detected project context', this.projectContext);
      } else {
        // Fallback for directories without detectable project structure
        const cwd = process.cwd();
        const pathHash = createHash('sha256').update(cwd).digest('hex').substring(0, 16);
        this.projectContext = {
          name: path.basename(cwd),
          pathHash,
          techStack: ['unknown'],
          projectType: 'general'
        };
        logger.info('Using fallback project context', this.projectContext);
      }
    } catch (error) {
      logger.error('Failed to detect project context', error);
      // Use ultimate fallback
      const cwd = process.cwd();
      const pathHash = createHash('sha256').update(cwd).digest('hex').substring(0, 16);
      this.projectContext = {
        name: path.basename(cwd),
        pathHash,
        techStack: ['unknown'],
        projectType: 'general'
      };
    }
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      try {
        const result = await this.client.listTools();
        return result;
      } catch (error) {
        logger.error('Failed to list tools from remote server', error);
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to connect to remote server: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        // Ensure we have project context before making tool calls
        await this.ensureProjectContext();
        
        // Inject project context into tool arguments
        const modifiedParams = {
          ...request.params,
          arguments: {
            ...request.params.arguments,
            _projectContext: this.projectContext
          }
        };
        
        const result = await this.client.callTool(modifiedParams);
        return result;
      } catch (error) {
        logger.error('Failed to call tool on remote server', { 
          tool: request.params.name, 
          error 
        });
        
        if (error instanceof McpError) {
          throw error;
        }
        
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to execute tool on remote server: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    });
  }

  async start(): Promise<void> {
    try {
      // Test connection to remote server
      const healthResponse = await fetch(`${this.remoteUrl}/`);
      if (!healthResponse.ok) {
        throw new Error(`Remote server not accessible: ${healthResponse.status}`);
      }

      const health = await healthResponse.json() as any;
      logger.info('Remote Tiger Memory server accessible', { 
        service: health.service,
        version: health.version,
        transport: health.transport
      });

      // Connect to remote server using SSE transport with authentication
      const apiKey = this.auth.getApiKey();
      if (!apiKey) {
        throw new Error('No API key found. Please run `tigermemory login` first.');
      }

      const sseUrl = new URL(`${this.remoteUrl}/mcp/sse`);
      sseUrl.searchParams.set('api_key', apiKey);
      const sseTransport = new SSEClientTransport(sseUrl);
      await this.client.connect(sseTransport);
      
      logger.info('Connected to remote server via SSE');

      // Start local server for Claude Code
      const serverTransport = new StdioServerTransport();
      await this.server.connect(serverTransport);
      
      logger.info('Tiger Memory Remote Client started');
      
    } catch (error) {
      logger.error('Failed to start remote client', error);
      process.exit(1);
    }
  }
}

if (require.main === module) {
  const client = new TigerMemoryRemoteClient();
  client.start().catch((error) => {
    console.error('Remote client startup failed:', error);
    process.exit(1);
  });
}