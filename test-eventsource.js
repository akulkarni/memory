#!/usr/bin/env node

console.log('Testing EventSource polyfill...');

try {
  const EventSource = require('eventsource');
  console.log('EventSource type:', typeof EventSource);
  console.log('EventSource constructor:', EventSource.constructor.name);
  console.log('EventSource:', EventSource);
  
  // Test setting it on global
  global.EventSource = EventSource;
  console.log('global.EventSource:', global.EventSource);
  console.log('global.EventSource type:', typeof global.EventSource);
  
  // Test creating an instance
  try {
    const es = new global.EventSource('http://example.com/events');
    console.log('✅ Successfully created EventSource instance');
    es.close();
  } catch (err) {
    console.log('❌ Failed to create EventSource instance:', err.message);
  }
  
} catch (error) {
  console.error('❌ Error requiring eventsource:', error);
}