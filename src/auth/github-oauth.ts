import * as jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { GitHubUser, AuthenticatedUser, ApiKey } from './types';
import { authConfig } from './config';
import { TigerCloudDB } from '../database';
import { TigerMemoryError, errorCodes } from '../logger';

export class GitHubOAuth {
  constructor(private db: TigerCloudDB) {}

  getAuthUrl(state?: string): string {
    const params = new URLSearchParams({
      client_id: authConfig.github.clientId,
      redirect_uri: authConfig.github.callbackUrl,
      scope: 'user:email',
      state: state || crypto.randomBytes(16).toString('hex')
    });
    
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  async exchangeCodeForToken(code: string): Promise<string> {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: authConfig.github.clientId,
        client_secret: authConfig.github.clientSecret,
        code,
      }),
    });

    const data = await response.json() as any;
    if (data.error) {
      throw new TigerMemoryError(
        `GitHub OAuth error: ${data.error_description}`,
        errorCodes.AUTH_FAILED,
        400
      );
    }

    return data.access_token;
  }

  async getGitHubUser(accessToken: string): Promise<GitHubUser> {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'TigerMemory/1.0.0',
      },
    });

    if (!response.ok) {
      throw new TigerMemoryError(
        'Failed to fetch GitHub user',
        errorCodes.AUTH_FAILED,
        response.status
      );
    }

    const user = await response.json() as any;
    
    // Get primary email if not public
    if (!user.email) {
      const emailResponse = await fetch('https://api.github.com/user/emails', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'User-Agent': 'TigerMemory/1.0.0',
        },
      });
      
      if (emailResponse.ok) {
        const emails = await emailResponse.json() as any[];
        const primaryEmail = emails.find((e: any) => e.primary);
        user.email = primaryEmail?.email;
      }
    }

    return {
      id: user.id,
      login: user.login,
      email: user.email,
      name: user.name,
      avatar_url: user.avatar_url,
    };
  }

  async createOrUpdateUser(githubUser: GitHubUser): Promise<AuthenticatedUser> {
    // Check if user exists
    const existingUser = await this.db.getUserByGitHubId(githubUser.id);
    
    if (existingUser) {
      // Update existing user
      await this.db.updateUser(existingUser.id!, {
        email: githubUser.email,
        username: githubUser.login,
        name: githubUser.name,
        avatar_url: githubUser.avatar_url,
      });
      
      return {
        id: existingUser.id!,
        github_id: existingUser.github_id,
        email: githubUser.email,
        username: githubUser.login,
        name: githubUser.name,
        avatar_url: githubUser.avatar_url,
        created_at: existingUser.created_at!,
      };
    } else {
      // Create new user
      const newUser = await this.db.createUser({
        github_id: githubUser.id,
        email: githubUser.email,
        username: githubUser.login,
        name: githubUser.name,
        avatar_url: githubUser.avatar_url,
      });
      return {
        id: newUser.id!,
        github_id: newUser.github_id,
        email: newUser.email,
        username: newUser.username,
        name: newUser.name,
        avatar_url: newUser.avatar_url,
        created_at: newUser.created_at!,
      };
    }
  }

  generateJWT(user: AuthenticatedUser): string {
    return jwt.sign(
      {
        userId: user.id,
        email: user.email,
        username: user.username,
      },
      authConfig.jwt.secret
    );
  }

  async generateApiKey(user: AuthenticatedUser, name: string = 'Default'): Promise<ApiKey & { key_hash: string }> {
    const key = authConfig.apiKey.prefix + crypto.randomBytes(32).toString('hex');
    const keyHash = crypto.createHash('sha256').update(key).digest('hex');
    
    const apiKey = await this.db.createApiKey({
      user_id: user.id,
      key_hash: keyHash,
      name,
    });

    return { 
      id: apiKey.id!, 
      user_id: apiKey.user_id, 
      key_hash: key, // Return actual key once for display
      name: apiKey.name,
      last_used_at: apiKey.last_used_at || null,
      created_at: apiKey.created_at!
    };
  }

  verifyJWT(token: string): any {
    try {
      return jwt.verify(token, authConfig.jwt.secret);
    } catch (error) {
      throw new TigerMemoryError(
        'Invalid JWT token',
        errorCodes.AUTH_FAILED,
        401
      );
    }
  }

  async verifyApiKey(key: string): Promise<AuthenticatedUser | null> {
    if (!key.startsWith(authConfig.apiKey.prefix)) {
      return null;
    }

    const keyHash = crypto.createHash('sha256').update(key).digest('hex');
    const apiKey = await this.db.getApiKeyByHash(keyHash);
    
    if (!apiKey) {
      return null;
    }

    // Update last used timestamp
    await this.db.updateApiKeyLastUsed(apiKey.id!);
    
    const user = await this.db.getUserById(apiKey.user_id!);
    if (!user) return null;
    return {
      id: user.id!,
      github_id: user.github_id,
      email: user.email,
      username: user.username,
      name: user.name,
      avatar_url: user.avatar_url,
      created_at: user.created_at!,
    };
  }
}