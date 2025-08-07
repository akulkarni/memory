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
        { id: '003_add_auth_support', file: '003_add_auth_support.sql' },
        { id: '004_git_based_projects', file: '004_git_based_projects.sql' }
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
      console.log('1. Run "tigermemory login" to authenticate and register with Claude Code');
      console.log('2. Start using Tiger Memory in any project directory');
      
    } catch (error) {
      console.error('❌ Migration failed:', error);
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
  .option('-u, --url <url>', 'Remote server URL', 'https://tigermemory.dev')
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
  .command('init')
  .description('Initialize Tiger Memory in current project directory')
  .option('--url <url>', 'Custom server URL', 'https://tigermemory.dev')
  .action(async (options) => {
    try {
      const mcpConfigPath = path.join(process.cwd(), '.mcp.json');
      
      // Check if .mcp.json already exists
      if (fs.existsSync(mcpConfigPath)) {
        console.log('⚠️  .mcp.json already exists in this directory');
        console.log('   Delete it first if you want to reinitialize');
        return;
      }

      // Create .mcp.json from template
      const templatePath = path.join(__dirname, '../templates/mcp.json');
      let mcpConfig;

      if (fs.existsSync(templatePath)) {
        // Use template and customize URL if provided
        const template = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));
        if (options.url !== 'https://tigermemory.dev') {
          template.mcpServers.tigermemory.env.TIGER_REMOTE_URL = options.url;
        }
        mcpConfig = template;
      } else {
        // Fallback to inline template
        mcpConfig = {
          mcpServers: {
            tigermemory: {
              command: "npx",
              args: ["tigermemory", "remote-client"],
              env: {
                TIGER_REMOTE_URL: options.url
              }
            }
          }
        };
      }

      // Write .mcp.json
      fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));

      console.log('🐅 Tiger Memory initialized successfully!');
      console.log(`📝 Created .mcp.json with server URL: ${options.url}`);
      console.log('\nNext steps:');
      console.log('1. Make sure you\'re logged in: tigermemory login');
      console.log('2. Open Claude Code in this directory');
      console.log('3. Tiger Memory will be automatically available');
      
      // Show current directory info
      const projectInfo = await ProjectDetector.detectProject();
      if (projectInfo) {
        console.log(`\n📁 Detected project: ${projectInfo.name}`);
        console.log(`🛠️  Tech stack: ${projectInfo.techStack.join(', ')}`);
      }

    } catch (error) {
      console.error('❌ Failed to initialize Tiger Memory:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Check Tiger Memory status and configuration')
  .action(async () => {
    try {
      console.log('🐅 Tiger Memory Status\n');

      // Check authentication
      if (!auth.isLoggedIn()) {
        console.log('❌ Authentication: Not logged in');
        console.log('💡 Run: tigermemory login\n');
        return;
      }

      const user = auth.getUser();
      console.log(`✅ Authentication: Logged in as ${user?.username || user?.email || 'unknown'}\n`);

      // Check for local .mcp.json
      const mcpConfigPath = path.join(process.cwd(), '.mcp.json');
      if (fs.existsSync(mcpConfigPath)) {
        try {
          const mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf-8'));
          const serverUrl = mcpConfig.mcpServers?.tigermemory?.env?.TIGER_REMOTE_URL;
          console.log('✅ Local configuration: .mcp.json found');
          console.log(`🌐 Remote server: ${serverUrl || 'default'}`);
        } catch (error) {
          console.log('⚠️  Local configuration: .mcp.json found but invalid');
        }
      } else {
        console.log('❌ Local configuration: No .mcp.json found');
        console.log('💡 Run: tigermemory init');
      }

      // Check Claude Code MCP registration
      try {
        const { spawn } = require('child_process');
        const claude = spawn('claude', ['mcp', 'list'], { stdio: 'pipe' });
        
        let output = '';
        claude.stdout.on('data', (data: any) => {
          output += data.toString();
        });

        await new Promise((resolve) => {
          claude.on('close', () => resolve(void 0));
        });

        if (output.includes('tigermemory')) {
          console.log('✅ Claude Code integration: Registered globally');
        } else {
          console.log('❌ Claude Code integration: Not registered');
          console.log('💡 Run: tigermemory login (to automatically register)');
        }
      } catch (error) {
        console.log('⚠️  Claude Code integration: Unable to check (Claude Code may not be installed)');
      }

      // Show current directory context (optional)
      const projectInfo = await ProjectDetector.detectProject();
      if (projectInfo) {
        console.log(`\n📁 Current project: ${projectInfo.name}`);
        console.log(`🛠️  Tech stack: ${projectInfo.techStack.join(', ')}`);
        console.log(`📊 Project type: ${projectInfo.projectType}`);
      } else {
        console.log('\n📂 Current directory: Not a recognized project (that\'s ok!)');
      }

      console.log('\n✨ Tiger Memory is ready to capture architectural decisions!');

    } catch (error) {
      console.error('❌ Status check failed:', error);
    }
  });

// Auth commands
const auth = new AuthManager();

program
  .command('login')
  .description('Login to Tiger Memory and register with Claude Code')
  .option('--local', 'Login to local development server')
  .option('--url <url>', 'Custom server URL')
  .option('--no-register', 'Skip automatic registration with Claude Code')
  .action(async (options) => {
    try {
      // Step 1: Authenticate
      await auth.login({ 
        local: options.local, 
        baseUrl: options.url 
      });

      // Step 2: Check for and create local .mcp.json if needed
      const mcpConfigPath = path.join(process.cwd(), '.mcp.json');
      if (!fs.existsSync(mcpConfigPath)) {
        console.log('\n📝 No .mcp.json found, creating local configuration...');
        
        try {
          const templatePath = path.join(__dirname, '../templates/mcp.json');
          let mcpConfig;

          if (fs.existsSync(templatePath)) {
            // Use template and customize URL if provided
            const template = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));
            if (options.url && options.url !== 'https://tigermemory.dev') {
              template.mcpServers.tigermemory.env.TIGER_REMOTE_URL = options.url;
            }
            mcpConfig = template;
          } else {
            // Fallback to inline template
            mcpConfig = {
              mcpServers: {
                tigermemory: {
                  command: "npx",
                  args: ["tigermemory", "remote-client"],
                  env: {
                    TIGER_REMOTE_URL: options.url || 'https://tigermemory.dev'
                  }
                }
              }
            };
          }

          fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
          const serverUrl = mcpConfig.mcpServers.tigermemory.env.TIGER_REMOTE_URL;
          console.log(`✅ Created .mcp.json with server: ${serverUrl}`);
        } catch (initError) {
          console.log('⚠️  Failed to create .mcp.json automatically. Run `tigermemory init` manually.');
        }
      }

      // Step 3: Register with Claude Code (unless --no-register)
      if (options.register !== false) {
        console.log('\n🔗 Registering Tiger Memory with Claude Code...');
        try {
          const { spawn } = require('child_process');
          const claude = spawn('claude', ['mcp', 'add', '--scope', 'user', 'tigermemory', 'npx', 'tigermemory', 'remote-client'], {
            stdio: 'pipe'
          });
          
          await new Promise((resolve, reject) => {
            claude.on('close', (code: any) => {
              if (code === 0) {
                console.log('✅ Tiger Memory registered globally with Claude Code');
                console.log('🎉 Tiger Memory is now available in ALL Claude Code sessions');
                resolve(void 0);
              } else {
                reject(new Error(`Claude MCP registration failed with code ${code}`));
              }
            });
            
            claude.on('error', reject);
          });
        } catch (registrationError) {
          console.log('⚠️  Automatic registration failed, but you can register manually:');
          console.log('   claude mcp add --scope user tigermemory npx tigermemory remote-client');
        }
      }

      console.log('\n🎉 Setup complete! Tiger Memory is ready to use.');
      console.log('💡 Open Claude Code in any directory - Tiger Memory will be automatically available.');
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

program
  .command('auth')
  .description('Authentication management commands')
  .addCommand(
    new Command('set-key')
      .description('Manually set Tiger Memory API key')
      .argument('<apiKey>', 'API key to set')
      .action(async (apiKey: string) => {
        try {
          if (!apiKey.startsWith('tm_')) {
            console.error('❌ Invalid API key format. API keys should start with "tm_"');
            process.exit(1);
          }
          
          // Save the API key using AuthManager
          auth.setApiKey(apiKey);
          console.log('✅ API key saved successfully');
          console.log('🔑 You can now use Tiger Memory CLI commands');
          
        } catch (error) {
          console.error('❌ Failed to save API key:', error instanceof Error ? error.message : 'Unknown error');
          process.exit(1);
        }
      })
  );

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