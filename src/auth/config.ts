import * as dotenv from 'dotenv';
import { AuthConfig } from './types.js';
import { TigerMemoryError, errorCodes } from '../logger';

dotenv.config();

function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new TigerMemoryError(
      `Missing required environment variable: ${key}`,
      errorCodes.MISSING_CONFIG,
      500
    );
  }
  return value;
}

export const authConfig: AuthConfig = {
  github: {
    clientId: getRequiredEnv('GITHUB_CLIENT_ID'),
    clientSecret: getRequiredEnv('GITHUB_CLIENT_SECRET'),
    callbackUrl: process.env['GITHUB_CALLBACK_URL'] || 'http://localhost:3000/auth/github/callback'
  },
  jwt: {
    secret: getRequiredEnv('JWT_SECRET'),
    expiresIn: process.env['JWT_EXPIRES_IN'] || '30d'
  },
  apiKey: {
    prefix: 'tm_'
  }
};

export const isLocalMode = !process.env['PORT'];

// For local testing with PORT=3000, still use localhost
const isLocalTesting = process.env['NODE_ENV'] !== 'production' && 
  (process.env['PORT'] === '3000' || !process.env['PORT']);

export const baseUrl = isLocalTesting
  ? 'http://localhost:3000' 
  : (process.env['BASE_URL'] || 'https://tigermemory.dev');