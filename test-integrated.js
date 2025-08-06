#!/usr/bin/env node

// Integrated test: Connect SSE and send message
const { AuthManager } = require('./dist/cli/auth.js');
const { EventSource } = require('eventsource');

const auth = new AuthManager();
const apiKey = auth.getApiKey();

if (!apiKey) {
  console.log('❌ No API key. Run `tigermemory login` first.');
  process.exit(1);
}

const serverUrl = 'https://tigermemory.onrender.com';
const sseUrl = new URL('/mcp/sse', serverUrl);
sseUrl.searchParams.set('api_key', apiKey);

console.log('🔗 Connecting to SSE...');

const es = new EventSource(sseUrl.href);

es.addEventListener('endpoint', async (event) => {
  console.log('📡 Received endpoint:', event.data);
  
  const messageUrl = new URL(event.data, serverUrl).href;
  console.log('📮 Sending message to:', messageUrl);
  
  const testMessage = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'test-client',
        version: '1.0.0'
      }
    }
  };

  try {
    const response = await fetch(messageUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testMessage)
    });
    
    console.log('📬 Response status:', response.status);
    const body = await response.text();
    console.log('📬 Response body:', body);
    
  } catch (error) {
    console.error('❌ POST error:', error.message);
  }
  
  es.close();
  process.exit(0);
});

es.onerror = (event) => {
  console.log('❌ SSE error:', event);
  process.exit(1);
};

// Timeout
setTimeout(() => {
  console.log('⏱️ Timeout');
  es.close();
  process.exit(1);
}, 10000);