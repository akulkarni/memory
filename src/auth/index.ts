export { GitHubOAuth } from './github-oauth';
export { AuthMiddleware } from './middleware';
export { createAuthRoutes } from './routes';
export { authConfig, isLocalMode, baseUrl } from './config';
export * from './types';

import { TigerCloudDB } from '../database';
import { AuthMiddleware } from './middleware';
import { createAuthRoutes } from './routes';
import { GitHubOAuth } from './github-oauth';

export interface AuthModule {
  middleware: AuthMiddleware;
  routes: any;
  oauth: GitHubOAuth;
}

export function createAuthModule(db: TigerCloudDB): AuthModule {
  const oauth = new GitHubOAuth(db);
  const middleware = new AuthMiddleware(db);
  const routes = createAuthRoutes(db);

  return {
    middleware,
    routes,
    oauth
  };
}