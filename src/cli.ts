#!/usr/bin/env node

import { Command } from 'commander';
import { ProjectDetector } from './project-detector';
import { TigerCloudDB } from './database';
import { AuthManager } from './cli/auth';
import * as path from 'path';
import * as fs from 'fs';
import { createLogger } from 'winston';
import * as dotenv from 'dotenv';

dotenv.config();

const logger = createLogger({
  level: 'info',
  format: require('winston').format.combine(
    require('winston').format.timestamp(),
    require('winston').format.colorize(),
    require('winston').format.simple()
  ),
  transports: [
    new (require('winston').transports.Console)()
  ]
});

// Migration status helpers
async function checkMigrationStatus(database: TigerCloudDB, migrationId: string): Promise<{ applied: boolean; appliedAt?: string }> {
  try {
    // Create migrations table if it doesn't exist
    await database['query'](`
      CREATE TABLE IF NOT EXISTS migrations (
        id VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    // Check if this migration has been applied
    const result = await database['query'](`
      SELECT applied_at FROM migrations WHERE id = $1
    `, [migrationId]);
    
    if (result.rows.length > 0) {
      return { 
        applied: true, 
        appliedAt: result.rows[0].applied_at.toISOString().split('T')[0] 
      };
    }
    
    return { applied: false };
  } catch (error) {
    // If we can't check, assume not applied
    return { applied: false };
  }
}

async function recordMigrationSuccess(database: TigerCloudDB, migrationId: string): Promise<void> {
  try {
    await database['query'](`
      INSERT INTO migrations (id, applied_at) 
      VALUES ($1, NOW())
      ON CONFLICT (id) DO UPDATE SET applied_at = NOW()
    `, [migrationId]);
  } catch (error) {
    logger.warn('Failed to record migration status', error);
  }
}

const program = new Command();

program
  .name('tigermemory')
  .description('Persistent memory system for Claude Code with architectural intelligence')
  .version('1.0.0');

program
  .command('migrate')
  .description('Run database migrations to set up Tiger Memory schema')
  .action(async () => {
    try {
      console.log('🐅 Running Tiger Memory database migrations...\n');

      if (!process.env['TIGER_CLOUD_CONNECTION_STRING']) {
        console.error('❌ TIGER_CLOUD_CONNECTION_STRING environment variable not set');
        console.log('\n   Please add the following to your environment:');
        console.log('   export TIGER_CLOUD_CONNECTION_STRING="postgresql://..."');
        process.exit(1);
      }

      const database = new TigerCloudDB();
      console.log('🔗 Connecting to Tiger Cloud...');
      
      try {
        await database.connect();
        console.log('✅ Connected to Tiger Cloud successfully\n');
      } catch (error) {
        console.error('❌ Failed to connect to Tiger Cloud:', error);
        process.exit(1);
      }

      // Check if all migrations have already been applied
      const migrations = [
        { id: '001_initial_schema', file: '001_initial_schema.sql', fallback: '001_simple_schema.sql' },
        { id: '002_fix_triggers', file: '002_fix_triggers.sql' },
        { id: '003_add_auth_support', file: '003_add_auth_support.sql' }
      ];
      
      let allApplied = true;
      for (const migration of migrations) {
        const applied = await checkMigrationStatus(database, migration.id);
        if (!applied.applied) {
          allApplied = false;
          break;
        }
      }
      
      if (allApplied) {
        console.log('✅ All database migrations already applied');
        await database.disconnect();
        return;
      }

      // Run migrations in sequence
      console.log('📄 Running database migrations...');

      for (const migration of migrations) {
        const applied = await checkMigrationStatus(database, migration.id);
        if (applied.applied) {
          console.log(`✅ Migration ${migration.id} already applied (${applied.appliedAt})`);
          continue;
        }

        console.log(`   Running migration: ${migration.id}`);
        let migrationSuccess = false;

        if (migration.id === '001_initial_schema') {
          // Try TimescaleDB version first, then fall back to simple version
          try {
            const timescalePath = path.join(__dirname, 'migrations', migration.file);
            const timescaleSQL = fs.readFileSync(timescalePath, 'utf-8');
            
            console.log('     Trying TimescaleDB + pgvector schema...');
            await database['query']('BEGIN');
            await database['query'](timescaleSQL);
            await database['query']('COMMIT');
            console.log('     ✅ TimescaleDB schema applied');
            migrationSuccess = true;
          } catch (timescaleError) {
            await database['query']('ROLLBACK');
            console.log('     TimescaleDB failed, trying simple schema...');
            
            try {
              const simplePath = path.join(__dirname, 'migrations', migration.fallback!);
              const simpleSQL = fs.readFileSync(simplePath, 'utf-8');
              
              await database['query']('BEGIN');
              await database['query'](simpleSQL);
              await database['query']('COMMIT');
              console.log('     ✅ Simple PostgreSQL schema applied');
              migrationSuccess = true;
            } catch (simpleError) {
              await database['query']('ROLLBACK');
              console.error(`❌ Migration ${migration.id} failed:`, simpleError);
              process.exit(1);
            }
          }
        } else {
          // Regular migration
          try {
            const migrationPath = path.join(__dirname, 'migrations', migration.file);
            const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');
            
            await database['query']('BEGIN');
            await database['query'](migrationSQL);
            await database['query']('COMMIT');
            console.log(`     ✅ Migration ${migration.id} applied`);
            migrationSuccess = true;
          } catch (error) {
            await database['query']('ROLLBACK');
            console.error(`❌ Migration ${migration.id} failed:`, error);
            process.exit(1);
          }
        }

        if (migrationSuccess) {
          await recordMigrationSuccess(database, migration.id);
        }
      }

      await database.disconnect();
      console.log('🎉 Tiger Memory database is ready!\n');
      console.log('Next steps:');
      console.log('1. Run "tigermemory init" in your project directory');
      console.log('2. Start using Tiger Memory with Claude Code');
      
    } catch (error) {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    }
  });

program
  .command('init')
  .description('Initialize Tiger Memory for the current project')
  .option('-f, --force', 'Force initialization even if already configured')
  .action(async (options) => {
    try {
      console.log('🐅 Initializing Tiger Memory...\n');

      const projectInfo = await ProjectDetector.detectProject();
      if (!projectInfo) {
        console.error('❌ No project detected. Please run this command in a project directory.');
        console.log('   Supported project types: package.json, pyproject.toml, Cargo.toml, go.mod, etc.');
        process.exit(1);
      }

      console.log(`📁 Project detected: ${projectInfo.name}`);
      console.log(`🏠 Root path: ${projectInfo.rootPath}`);
      console.log(`🛠️  Tech stack: ${projectInfo.techStack.join(', ')}`);
      console.log(`📊 Project type: ${projectInfo.projectType}`);
      console.log(`🔑 Project ID: ${projectInfo.pathHash}\n`);

      if (!process.env['TIGER_CLOUD_CONNECTION_STRING']) {
        console.error('❌ TIGER_CLOUD_CONNECTION_STRING environment variable not set');
        console.log('\n   Please add the following to your environment:');
        console.log('   export TIGER_CLOUD_CONNECTION_STRING="postgresql://..."');
        console.log('\n   Or create a .env file in your project root with:');
        console.log('   TIGER_CLOUD_CONNECTION_STRING=postgresql://...');
        process.exit(1);
      }

      if (!process.env['ANTHROPIC_API_KEY']) {
        console.error('❌ ANTHROPIC_API_KEY environment variable not set');
        console.log('\n   Please add the following to your environment:');
        console.log('   export ANTHROPIC_API_KEY="sk-..."');
        console.log('\n   Or add it to your .env file:');
        console.log('   ANTHROPIC_API_KEY=sk-...');
        process.exit(1);
      }

      const database = new TigerCloudDB();
      console.log('🔗 Connecting to Tiger Cloud...');
      
      try {
        await database.connect();
        console.log('✅ Connected to Tiger Cloud successfully\n');
      } catch (error) {
        console.error('❌ Failed to connect to Tiger Cloud:', error);
        process.exit(1);
      }

      let project = await database.getProject(projectInfo.pathHash);
      
      if (project && !options.force) {
        console.log('✅ Project already registered in Tiger Memory');
        console.log(`   Created: ${project.created_at?.toISOString().split('T')[0]}`);
      } else {
        if (options.force && project) {
          console.log('🔄 Force flag specified, updating project information...');
        }
        
        project = await database.createProject({
          name: projectInfo.name,
          path_hash: projectInfo.pathHash,
          tech_stack: projectInfo.techStack,
          project_type: projectInfo.projectType
        });
        
        console.log('✅ Project registered in Tiger Memory');
      }

      const mcpConfigPath = path.join(projectInfo.rootPath, '.claude_mcp_config.json');
      const mcpConfig = {
        mcpServers: {
          tigermemory: {
            command: 'npx',
            args: ['tigermemory', 'server'],
            env: {
              TIGER_CLOUD_CONNECTION_STRING: process.env['TIGER_CLOUD_CONNECTION_STRING'],
              ANTHROPIC_API_KEY: process.env['ANTHROPIC_API_KEY']
            }
          }
        }
      };

      if (!fs.existsSync(mcpConfigPath) || options.force) {
        fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
        console.log('📄 MCP configuration created: .claude_mcp_config.json');
      } else {
        console.log('📄 MCP configuration already exists (use --force to overwrite)');
      }

      await database.disconnect();

      console.log('\n🎉 Tiger Memory initialization complete!\n');
      console.log('Next steps:');
      console.log('1. Restart Claude Code to load the new MCP server');
      console.log('2. Start coding - Tiger Memory will automatically capture decisions');
      console.log('3. Ask Claude to "recall our project context" to see stored decisions\n');
      
      console.log('Available commands in Claude Code:');
      console.log('• remember_decision - Store architectural decisions');
      console.log('• recall_context - Retrieve project context');
      console.log('• discover_patterns - Find architectural patterns');
      console.log('• get_timeline - View decision timeline');
      
    } catch (error) {
      console.error('❌ Initialization failed:', error);
      process.exit(1);
    }
  });

program
  .command('server')
  .description('Start the Tiger Memory MCP server (used internally by Claude Code)')
  .action(async () => {
    try {
      const { TigerMemoryServer } = await import('./server.js');
      const server = new TigerMemoryServer();
      await server.start();
    } catch (error) {
      logger.error('Failed to start MCP server:', error);
      process.exit(1);
    }
  });

program
  .command('remote-client')
  .description('Start the Tiger Memory remote client (connects to remote MCP server)')
  .option('-u, --url <url>', 'Remote server URL', 'https://tigermemory.onrender.com')
  .action(async (options) => {
    if (!auth.isLoggedIn()) {
      console.error('❌ Not logged in. Run `tigermemory login` first.');
      process.exit(1);
    }
    try {
      process.env['TIGER_REMOTE_URL'] = options.url;
      const { TigerMemoryRemoteClient } = await import('./remote-client.js');
      const client = new TigerMemoryRemoteClient();
      await client.start();
    } catch (error) {
      logger.error('Failed to start remote client:', error);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Check Tiger Memory status for the current project')
  .action(async () => {
    try {
      console.log('🐅 Tiger Memory Status\n');

      const projectInfo = await ProjectDetector.detectProject();
      if (!projectInfo) {
        console.log('❌ No project detected in current directory');
        return;
      }

      console.log(`📁 Project: ${projectInfo.name}`);
      console.log(`🔑 Project ID: ${projectInfo.pathHash}`);
      console.log(`🛠️  Tech Stack: ${projectInfo.techStack.join(', ')}`);
      console.log(`📊 Type: ${projectInfo.projectType}\n`);

      if (!process.env['TIGER_CLOUD_CONNECTION_STRING']) {
        console.log('❌ TIGER_CLOUD_CONNECTION_STRING not configured');
        return;
      }

      const database = new TigerCloudDB();
      
      try {
        await database.connect();
        console.log('✅ Tiger Cloud connection: OK');
        
        const project = await database.getProject(projectInfo.pathHash);
        if (project) {
          console.log(`✅ Project registered: ${project.created_at?.toISOString().split('T')[0]}`);
          
          const decisions = await database.getProjectDecisions(project.id!, 1);
          console.log(`📊 Total decisions stored: ${decisions.length > 0 ? 'Available' : 'None yet'}`);
        } else {
          console.log('❌ Project not registered (run: tigermemory init)');
        }
        
        await database.disconnect();
      } catch (error) {
        console.log('❌ Tiger Cloud connection: FAILED');
        console.log(`   Error: ${error}`);
      }

      const mcpConfigPath = path.join(projectInfo.rootPath, '.claude_mcp_config.json');
      if (fs.existsSync(mcpConfigPath)) {
        console.log('✅ MCP configuration: OK');
      } else {
        console.log('❌ MCP configuration: Missing (run: tigermemory init)');
      }

    } catch (error) {
      console.error('❌ Status check failed:', error);
    }
  });

program
  .command('reset')
  .description('Reset Tiger Memory configuration for the current project')
  .option('--confirm', 'Confirm the reset operation')
  .action(async (options) => {
    if (!options.confirm) {
      console.log('⚠️  This will remove the local MCP configuration.');
      console.log('   Project data in Tiger Cloud will remain intact.');
      console.log('   Run with --confirm to proceed.');
      return;
    }

    try {
      const projectInfo = await ProjectDetector.detectProject();
      if (!projectInfo) {
        console.log('❌ No project detected in current directory');
        return;
      }

      const mcpConfigPath = path.join(projectInfo.rootPath, '.claude_mcp_config.json');
      if (fs.existsSync(mcpConfigPath)) {
        fs.unlinkSync(mcpConfigPath);
        console.log('✅ MCP configuration removed');
      } else {
        console.log('ℹ️  No MCP configuration found');
      }

      console.log('\n🔄 Reset complete. Run "tigermemory init" to reconfigure.');
      
    } catch (error) {
      console.error('❌ Reset failed:', error);
    }
  });

// Auth commands
const auth = new AuthManager();

program
  .command('login')
  .description('Login to Tiger Memory with GitHub OAuth')
  .option('--local', 'Login to local development server')
  .option('--url <url>', 'Custom server URL')
  .action(async (options) => {
    try {
      await auth.login({ 
        local: options.local, 
        baseUrl: options.url 
      });
    } catch (error) {
      console.error('❌ Login failed:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

program
  .command('logout')
  .description('Logout from Tiger Memory')
  .action(async () => {
    try {
      if (!auth.isLoggedIn()) {
        console.log('ℹ️  You are not currently logged in.');
        return;
      }
      
      auth.logout();
      console.log('✅ Successfully logged out from Tiger Memory');
    } catch (error) {
      console.error('❌ Logout failed:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

program
  .command('whoami')
  .description('Show current Tiger Memory user')
  .action(async () => {
    try {
      if (!auth.isLoggedIn()) {
        console.log('❌ Not logged in. Run `tigermemory login` to authenticate.');
        return;
      }
      
      const user = auth.getUser();
      const apiKey = auth.getApiKey();
      
      console.log('🐅 Tiger Memory Authentication Status\n');
      console.log(`✅ Logged in as: @${user?.username || 'unknown'}`);
      if (user?.email) {
        console.log(`📧 Email: ${user.email}`);
      }
      console.log(`🔑 API Key: ${apiKey?.substring(0, 12)}...`);
    } catch (error) {
      console.error('❌ Failed to get user info:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

// MCP client test command
program
  .command('test-connection')
  .description('Test connection to Tiger Memory service')
  .option('--local', 'Test local server connection')
  .option('--url <url>', 'Custom server URL')
  .action(async (options) => {
    try {
      if (!options.local && !auth.isLoggedIn()) {
        console.error('❌ Not logged in. Run `tigermemory login` first.');
        process.exit(1);
      }

      console.log('🤖 Testing Tiger Memory connection...');
      
      const { TigerMemoryMCPClient } = await import('./mcp-client');
      const client = new TigerMemoryMCPClient({
        serverUrl: options.url,
        useLocal: options.local
      });
      
      await client.connect();
      
      // Test listing tools
      const tools = await client.listTools();
      console.log(`✅ Connected successfully!`);
      console.log(`🔧 Available tools: ${tools.tools.map(t => t.name).join(', ')}`);
      
      if (client.isAuthenticated()) {
        const user = client.getUserInfo();
        console.log(`👤 Authenticated as: @${user?.username || 'unknown'}`);
      }
      
      await client.disconnect();
    } catch (error) {
      console.error('❌ Connection test failed:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

if (process.argv.length === 2) {
  program.help();
}

program.parse();