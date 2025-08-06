import { Request, Response, Router } from 'express';
import { GitHubOAuth } from './github-oauth';
import { TigerCloudDB } from '../database';
import { logger } from '../logger';
import { baseUrl, isLocalMode } from './config';

export function createAuthRoutes(db: TigerCloudDB): Router {
  const router = Router();
  const oauth = new GitHubOAuth(db);

  // Start GitHub OAuth flow
  router.get('/github', (req: Request, res: Response) => {
    const state = req.query['state'] as string;
    const authUrl = oauth.getAuthUrl(state);
    
    logger.info('Starting GitHub OAuth flow', { 
      authUrl: authUrl.substring(0, 50) + '...',
      state 
    });
    
    res.redirect(authUrl);
  });

  // Handle GitHub OAuth callback
  router.get('/github/callback', async (req: Request, res: Response) => {
    try {
      const { code, error, error_description } = req.query;

      if (error) {
        logger.warn('GitHub OAuth error', { error, error_description });
        return res.redirect(`${baseUrl}/auth/error?error=${error}`);
      }

      if (!code) {
        return res.redirect(`${baseUrl}/auth/error?error=missing_code`);
      }

      // Exchange code for access token
      const accessToken = await oauth.exchangeCodeForToken(code as string);
      
      // Get GitHub user info
      const githubUser = await oauth.getGitHubUser(accessToken);
      
      // Create or update user in database
      const user = await oauth.createOrUpdateUser(githubUser);
      
      logger.info('User authenticated', { 
        userId: user.id, 
        username: user.username 
      });

      // Check if this is a CLI callback (has callback_port parameter)
      const callbackPort = req.query['callback_port'] as string;
      
      if (callbackPort && !isNaN(parseInt(callbackPort))) {
        // CLI callback: Generate API key and redirect to local CLI callback
        const apiKey = await oauth.generateApiKey(user, 'CLI Login');
        const callbackUrl = `http://localhost:${callbackPort}/callback?apiKey=${apiKey.key_hash}&username=${user.username}&email=${user.email || ''}`;
        res.redirect(callbackUrl);
      } else if (isLocalMode) {
        // Local mode: Set JWT cookie and redirect to success page
        const jwt = oauth.generateJWT(user);
        res.cookie('token', jwt, {
          httpOnly: true,
          secure: false, // HTTP in local mode
          maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        });
        res.redirect(`${baseUrl}/auth/success?mode=local&username=${user.username}`);
      } else {
        // Remote mode: Generate API key and redirect to success page
        const apiKey = await oauth.generateApiKey(user, 'CLI Login');
        res.redirect(`${baseUrl}/auth/success?mode=remote&username=${user.username}&apiKey=${apiKey.key_hash}`);
      }
    } catch (error) {
      logger.error('GitHub OAuth callback error', error);
      res.redirect(`${baseUrl}/auth/error?error=callback_failed`);
    }
  });

  // Success page
  router.get('/success', (req: Request, res: Response) => {
    const { mode, username, apiKey } = req.query;
    
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Tiger Memory - Authentication Success</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
          .success { color: #22c55e; font-size: 24px; margin-bottom: 20px; }
          .code { background: #f3f4f6; padding: 15px; border-radius: 8px; font-family: monospace; margin: 10px 0; }
          .copy-btn { background: #3b82f6; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; }
          .warning { background: #fef3c7; padding: 15px; border-radius: 8px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="success">✅ Successfully logged in as @${username}!</div>
    `;

    if (mode === 'local') {
      html += `
        <p>You're now authenticated for local development.</p>
        <p><strong>You can close this window and return to your terminal.</strong></p>
      `;
    } else {
      html += `
        <p>Your API key has been generated:</p>
        <div class="code">
          <code id="apiKey">${apiKey}</code>
          <button class="copy-btn" onclick="copyApiKey()">Copy</button>
        </div>
        <div class="warning">
          <strong>⚠️ Important:</strong> Save this API key securely. You won't be able to see it again.
        </div>
        <p>The CLI tool should automatically detect and save this key.</p>
        <p><strong>You can close this window and return to your terminal.</strong></p>
        
        <script>
          function copyApiKey() {
            navigator.clipboard.writeText('${apiKey}');
            document.querySelector('.copy-btn').textContent = 'Copied!';
          }
          
          // Auto-copy API key
          if (navigator.clipboard) {
            navigator.clipboard.writeText('${apiKey}');
          }
        </script>
      `;
    }

    html += `
      </body>
      </html>
    `;

    res.send(html);
  });

  // Error page
  router.get('/error', (req: Request, res: Response) => {
    const { error } = req.query;
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Tiger Memory - Authentication Error</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
          .error { color: #ef4444; font-size: 24px; margin-bottom: 20px; }
        </style>
      </head>
      <body>
        <div class="error">❌ Authentication failed</div>
        <p>Error: ${error}</p>
        <p>Please try again or contact support if the problem persists.</p>
        <p><a href="${baseUrl}/auth/github">Try again</a></p>
      </body>
      </html>
    `;

    res.send(html);
  });

  // Get current user info (for authenticated requests)
  router.get('/me', async (req: any, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    return res.json({
      user: {
        id: req.user.id,
        username: req.user.username,
        email: req.user.email,
        name: req.user.name,
        avatar_url: req.user.avatar_url,
      }
    });
  });

  return router;
}