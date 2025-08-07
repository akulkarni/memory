#!/usr/bin/env node

// EventSource polyfill for Node.js (must be set up before importing MCP SDK)
if (typeof global !== 'undefined' && !(global as any).EventSource) {
  const { EventSource } = require('eventsource');
  (global as any).EventSource = EventSource;
}

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { AuthManager } from './cli/auth';
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

export class TigerMemoryMCPClient {
  private client: Client;
  private transport: SSEClientTransport | StdioClientTransport;
  private auth: AuthManager;
  private isRemote: boolean;

  constructor(options: {
    serverUrl?: string;
    apiKey?: string;
    useLocal?: boolean;
  } = {}) {
    this.auth = new AuthManager();
    this.isRemote = !options.useLocal;

    const serverUrl = options.serverUrl || process.env['TIGERMEMORY_SERVER_URL'] || 'https://tigermemory.dev';
    const apiKey = options.apiKey || this.auth.getApiKey();

    if (this.isRemote) {
      if (!apiKey) {
        throw new Error('API key required for remote connection. Run `tigermemory login` first.');
      }

      // Remote connection using SSE transport with API key in URL
      const sseUrl = new URL('/mcp/sse', serverUrl);
      sseUrl.searchParams.set('api_key', apiKey);
      this.transport = new SSEClientTransport(sseUrl);
    } else {
      // Local connection using stdio transport
      this.transport = new StdioClientTransport({
        command: 'tigermemory',
        args: ['server'],
        env: {
          ...process.env,
          TIGER_CLOUD_CONNECTION_STRING: process.env['TIGER_CLOUD_CONNECTION_STRING'] || '',
          ANTHROPIC_API_KEY: process.env['ANTHROPIC_API_KEY'] || ''
        }
      });
    }

    this.client = new Client(
      {
        name: 'tigermemory-client',
        version: '1.0.0',
      },
      {
        capabilities: {}
      }
    );
  }

  async connect(): Promise<void> {
    try {
      logger.info('Connecting to Tiger Memory server...', {
        remote: this.isRemote,
        authenticated: this.isRemote ? !!this.auth.getApiKey() : false
      });

      await this.client.connect(this.transport);
      logger.info('Connected to Tiger Memory server successfully');
    } catch (error) {
      logger.error('Failed to connect to Tiger Memory server', { error });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.client.close();
      logger.info('Disconnected from Tiger Memory server');
    } catch (error) {
      logger.error('Error during disconnect', { error });
    }
  }

  async rememberDecision(params: {
    decision: string;
    reasoning: string;
    type: 'tech_stack' | 'architecture' | 'pattern' | 'tool_choice';
    alternatives_considered?: string[];
    files_affected?: string[];
    confidence: number;
    public: boolean;
  }) {
    try {
      const result = await this.client.callTool({
        name: 'remember_decision',
        arguments: params
      });
      return result;
    } catch (error) {
      logger.error('Error calling remember_decision', { error, params });
      throw error;
    }
  }

  async recallContext(params: {
    query?: string;
    limit?: number;
  } = {}) {
    try {
      const result = await this.client.callTool({
        name: 'recall_context',
        arguments: params
      });
      return result;
    } catch (error) {
      logger.error('Error calling recall_context', { error, params });
      throw error;
    }
  }

  async discoverPatterns(params: {
    query: string;
    tech_stack?: string[];
    project_type?: string;
  }) {
    try {
      const result = await this.client.callTool({
        name: 'discover_patterns',
        arguments: params
      });
      return result;
    } catch (error) {
      logger.error('Error calling discover_patterns', { error, params });
      throw error;
    }
  }

  async getTimeline(params: {
    since?: string;
    category?: 'tech_stack' | 'architecture' | 'pattern' | 'tool_choice';
  } = {}) {
    try {
      const result = await this.client.callTool({
        name: 'get_timeline',
        arguments: params
      });
      return result;
    } catch (error) {
      logger.error('Error calling get_timeline', { error, params });
      throw error;
    }
  }

  async listTools() {
    try {
      const result = await this.client.listTools();
      return result;
    } catch (error) {
      logger.error('Error listing tools', { error });
      throw error;
    }
  }

  getUserInfo() {
    return this.auth.getUser();
  }

  isAuthenticated(): boolean {
    return this.auth.isLoggedIn();
  }
}

// CLI usage
if (require.main === module) {
  const client = new TigerMemoryMCPClient();
  
  async function main() {
    try {
      await client.connect();
      
      // Example usage
      const tools = await client.listTools();
      console.log('Available tools:', tools.tools.map(t => t.name));
      
      // Keep connection alive
      process.on('SIGINT', async () => {
        console.log('\nShutting down...');
        await client.disconnect();
        process.exit(0);
      });
      
    } catch (error) {
      console.error('Client error:', error);
      process.exit(1);
    }
  }
  
  main();
}