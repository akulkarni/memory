#!/usr/bin/env node

// Test POST to message endpoint
const sessionId = '655706b5-6266-4c59-9bf8-d41ff012b573'; // From SSE test
const messageUrl = `https://tigermemory.dev/mcp/message?sessionId=${sessionId}`;

console.log('🔗 Testing POST to message endpoint...');
console.log('URL:', messageUrl);

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

fetch(messageUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(testMessage)
})
.then(response => {
  console.log('Status:', response.status);
  console.log('Headers:', Object.fromEntries(response.headers.entries()));
  return response.text();
})
.then(body => {
  console.log('Response body:', body);
})
.catch(error => {
  console.error('Error:', error.message);
});