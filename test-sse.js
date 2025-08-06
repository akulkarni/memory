#!/usr/bin/env node

// Simple test to see if SSE connection works
const { AuthManager } = require('./dist/cli/auth.js');
const auth = new AuthManager();
const apiKey = auth.getApiKey();

if (!apiKey) {
  console.log('❌ No API key. Run `tigermemory login` first.');
  process.exit(1);
}

const serverUrl = 'https://tigermemory.onrender.com';
const sseUrl = new URL('/mcp/sse', serverUrl);
sseUrl.searchParams.set('api_key', apiKey);

console.log('🔗 Connecting to SSE endpoint...');
console.log('URL:', sseUrl.href);

// Use eventsource directly
const { EventSource } = require('eventsource');
const es = new EventSource(sseUrl.href);

es.onopen = () => {
  console.log('✅ SSE connection opened');
};

es.onmessage = (event) => {
  console.log('📩 Received message:', event.data);
};

es.onerror = (event) => {
  console.log('❌ SSE error:', event);
};

// Listen for specific MCP events
es.addEventListener('endpoint', (event) => {
  console.log('📡 Received endpoint:', event.data);
  es.close();
});

// Timeout after 10 seconds
setTimeout(() => {
  console.log('⏱️ Timeout - closing connection');
  es.close();
  process.exit(0);
}, 10000);