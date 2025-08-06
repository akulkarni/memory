import { Response, NextFunction } from 'express';
import { AuthRequest, AuthenticatedUser } from './types';
import { GitHubOAuth } from './github-oauth';
import { TigerCloudDB } from '../database';
import { logger } from '../logger';

export class AuthMiddleware {
  private oauth: GitHubOAuth;

  constructor(db: TigerCloudDB) {
    this.oauth = new GitHubOAuth(db);
  }

  // Extract user from JWT token or API key
  async extractUser(req: AuthRequest, _res: Response, next: NextFunction): Promise<void> {
    try {
      let user: AuthenticatedUser | null = null;

      // Try Authorization header first (API key or Bearer token)
      const authHeader = req.headers['authorization'];
      if (authHeader) {
        if (authHeader.startsWith('Bearer ')) {
          // JWT token
          const token = authHeader.substring(7);
          const decoded = this.oauth.verifyJWT(token);
          user = await this.getUserFromJWT(decoded);
        } else if (authHeader.startsWith('ApiKey ')) {
          // API key
          const apiKey = authHeader.substring(7);
          user = await this.oauth.verifyApiKey(apiKey);
        }
      }

      // Try query parameter for API key (less secure but convenient)
      if (!user && (req as any).query?.api_key) {
        const apiKey = (req as any).query.api_key as string;
        user = await this.oauth.verifyApiKey(apiKey);
      }

      // Try cookie for JWT (web sessions)
      if (!user && (req as any).cookies?.token) {
        const decoded = this.oauth.verifyJWT((req as any).cookies.token);
        user = await this.getUserFromJWT(decoded);
      }

      if (user) {
        req.user = user;
        logger.debug('User authenticated', { userId: user.id, username: user.username });
      }

      next();
    } catch (error) {
      logger.warn('Authentication failed', { error: (error as Error).message });
      next(); // Continue without user - let route handlers decide if auth is required
    }
  }

  // Require authentication - return 401 if no user
  requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
    if (!req.user) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'Please provide a valid API key or JWT token'
      });
      return;
    }
    next();
  }

  // Optional authentication - sets user if available, continues regardless
  optionalAuth = this.extractUser;

  private async getUserFromJWT(decoded: any): Promise<AuthenticatedUser | null> {
    // JWT contains basic user info, but we might want to refresh from DB
    // For now, construct user from JWT claims
    return {
      id: decoded.userId,
      github_id: 0, // Not stored in JWT
      email: decoded.email,
      username: decoded.username,
      name: null, // Not stored in JWT
      avatar_url: '', // Not stored in JWT
      created_at: new Date(), // Placeholder
    };
  }
}