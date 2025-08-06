#!/usr/bin/env node

const { TigerMemoryMCPClient } = require('./dist/mcp-client.js');

async function testTigerMemory() {
  console.log('🐅 Testing Tiger Memory...\n');

  try {
    // Test with remote server
    console.log('📡 Testing remote connection...');
    const client = new TigerMemoryMCPClient();
    
    console.log(`🔐 Authenticated: ${client.isAuthenticated()}`);
    console.log(`👤 User: ${JSON.stringify(client.getUserInfo())}`);
    
    if (!client.isAuthenticated()) {
      console.log('❌ Not authenticated. Run `tigermemory login` first.');
      return;
    }

    await client.connect();
    console.log('✅ Connected to Tiger Memory server');

    // Test remember decision
    console.log('\n📝 Testing remember_decision...');
    const result = await client.rememberDecision({
      decision: 'Use Node.js for Tiger Memory CLI',
      reasoning: 'Node.js provides excellent npm ecosystem and TypeScript support for CLI applications',
      type: 'tech_stack',
      alternatives_considered: ['Python', 'Go', 'Rust'],
      files_affected: ['src/cli.ts', 'package.json'],
      confidence: 0.8,
      public: true
    });
    console.log('Result:', result);

    // Test recall context
    console.log('\n🔍 Testing recall_context...');
    const context = await client.recallContext({
      query: 'Node.js CLI',
      limit: 5
    });
    console.log('Context:', context);

    await client.disconnect();
    console.log('\n✅ All tests completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Full error:', error);
  }
}

testTigerMemory();