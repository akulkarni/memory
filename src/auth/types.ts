export interface GitHubUser {
  id: number;
  login: string;
  email: string;
  name: string | null;
  avatar_url: string;
}

export interface AuthenticatedUser {
  id: string;
  github_id: number;
  email: string;
  username: string;
  name: string | null;
  avatar_url: string;
  created_at: Date;
}

export interface ApiKey {
  id: string;
  user_id: string;
  key_hash: string;
  name: string;
  last_used_at: Date | null;
  created_at: Date;
}

import { Request } from 'express';

export interface AuthRequest extends Request {
  user?: AuthenticatedUser;
}

export interface AuthConfig {
  github: {
    clientId: string;
    clientSecret: string;
    callbackUrl: string;
  };
  jwt: {
    secret: string;
    expiresIn: string;
  };
  apiKey: {
    prefix: string;
  };
}