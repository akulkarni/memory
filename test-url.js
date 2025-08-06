#!/usr/bin/env node

const { AuthManager } = require('./dist/cli/auth.js');

const auth = new AuthManager();
const apiKey = auth.getApiKey();

console.log('API Key:', apiKey ? `${apiKey.substring(0, 12)}...` : 'None');

if (apiKey) {
  const serverUrl = 'https://tigermemory.onrender.com';
  const sseUrl = new URL('/mcp/sse', serverUrl);
  sseUrl.searchParams.set('api_key', apiKey);
  
  console.log('SSE URL:', sseUrl.href);
  
  // Test the URL manually
  console.log('\nTesting SSE endpoint...');
  
  fetch(sseUrl.href)
    .then(response => {
      console.log('Status:', response.status);
      console.log('Headers:', Object.fromEntries(response.headers.entries()));
      return response.text();
    })
    .then(body => {
      console.log('Body:', body.substring(0, 200));
    })
    .catch(error => {
      console.error('Error:', error.message);
    });
} else {
  console.log('❌ No API key found. Run `tigermemory login` first.');
}