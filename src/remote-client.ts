#!/usr/bin/env node

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
  private remoteUrl: string;

  constructor() {
    this.remoteUrl = process.env['TIGER_REMOTE_URL'] || 'https://tigermemory.onrender.com';
    
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

    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      try {
        const response = await fetch(`${this.remoteUrl}/mcp/list_tools`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 })
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json() as any;
        return result.result || { tools: [] };
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
        const response = await fetch(`${this.remoteUrl}/mcp/call_tool`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'tools/call',
            params: request.params,
            id: 1
          })
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json() as any;
        
        if (result.error) {
          throw new McpError(
            result.error.code || ErrorCode.InternalError,
            result.error.message || 'Remote tool execution failed'
          );
        }

        return result.result;
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
      logger.info('Connected to remote Tiger Memory server', { 
        service: health.service,
        version: health.version,
        transport: health.transport
      });

      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      
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