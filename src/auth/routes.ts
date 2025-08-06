import { Request, Response, Router } from 'express';
import { GitHubOAuth } from './github-oauth';
import { TigerCloudDB } from '../database';
import { logger } from '../logger';
import { baseUrl, isLocalMode } from './config';

export function createAuthRoutes(db: TigerCloudDB): Router {
  const router = Router();
  const oauth = new GitHubOAuth(db);
  
  // Device flow storage (in production, use Redis or database)
  const deviceCodes = new Map<string, {
    user_code: string;
    expires_at: number;
    user_id?: string;
    apiKey?: string;
    username?: string;
    email?: string;
  }>();

  // Device flow - Start authorization
  router.post('/device', (_req: Request, res: Response) => {
    const device_code = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const user_code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const expires_in = 600; // 10 minutes
    
    deviceCodes.set(device_code, {
      user_code,
      expires_at: Date.now() + (expires_in * 1000),
    });
    
    res.json({
      device_code,
      user_code,
      verification_uri: `${baseUrl}/auth/device/verify`,
      expires_in,
      interval: 5
    });
  });

  // Device flow - Verification page
  router.get('/device/verify', (req: Request, res: Response) => {
    const user_code = req.query['user_code'] as string;
    
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Tiger Memory - Device Authorization</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
          .form { background: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .input { padding: 12px; font-size: 18px; border: 2px solid #e5e7eb; border-radius: 6px; width: 200px; text-align: center; text-transform: uppercase; }
          .button { background: #3b82f6; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-size: 16px; }
          .button:hover { background: #2563eb; }
          .code { font-family: monospace; font-size: 24px; font-weight: bold; color: #1f2937; }
          .error { color: #dc2626; margin: 10px 0; }
        </style>
      </head>
      <body>
        <h1>🐅 Tiger Memory Device Authorization</h1>
        <p>Enter the code displayed in your CLI:</p>
        
        <form method="post" action="/auth/device/verify" class="form">
          <input type="text" name="user_code" placeholder="ENTER CODE" class="input" value="${user_code || ''}" required maxlength="8">
          <br><br>
          <button type="submit" class="button">Continue with GitHub</button>
        </form>
        
        ${user_code ? `<p class="code">Code: ${user_code}</p>` : ''}
      </body>
      </html>
    `;
    
    res.send(html);
  });

  // Device flow - Handle verification
  router.post('/device/verify', (req: Request, res: Response) => {
    const user_code = req.body.user_code?.toUpperCase();
    
    if (!user_code) {
      return res.redirect('/auth/device/verify?error=missing_code');
    }

    // Find device by user code
    let deviceCode: string | undefined;
    for (const [code, data] of deviceCodes) {
      if (data.user_code === user_code && data.expires_at > Date.now()) {
        deviceCode = code;
        break;
      }
    }

    if (!deviceCode) {
      return res.redirect('/auth/device/verify?error=invalid_code');
    }

    // Redirect to GitHub OAuth with device code in state
    const state = deviceCode;
    const authUrl = oauth.getAuthUrl(state);
    res.redirect(authUrl);
  });

  // Device flow - Token polling endpoint
  router.post('/device/token', (req: Request, res: Response) => {
    const { device_code } = req.body;
    
    if (!device_code) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    const deviceData = deviceCodes.get(device_code);
    if (!deviceData) {
      return res.status(400).json({ error: 'invalid_grant' });
    }

    if (deviceData.expires_at < Date.now()) {
      deviceCodes.delete(device_code);
      return res.status(400).json({ error: 'expired_token' });
    }

    if (!deviceData.apiKey) {
      return res.status(400).json({ error: 'authorization_pending' });
    }

    // Return the API key and clean up
    const result = {
      apiKey: deviceData.apiKey,
      username: deviceData.username,
      email: deviceData.email
    };
    
    deviceCodes.delete(device_code);
    return res.json(result);
  });

  // Start GitHub OAuth flow (legacy and device flow callback)
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
      const { code, error, error_description, state } = req.query;

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

      // Check if this is a device flow (state contains device code)
      if (state && deviceCodes.has(state as string)) {
        // Device flow: Store API key in device data
        const apiKey = await oauth.generateApiKey(user, 'CLI Device Flow');
        const deviceData = deviceCodes.get(state as string)!;
        deviceData.user_id = user.id;
        deviceData.apiKey = apiKey.key_hash;
        deviceData.username = user.username;
        deviceData.email = user.email;
        
        res.send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Tiger Memory - Authentication Complete</title>
            <style>
              body { font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
              .success { color: #22c55e; font-size: 24px; margin-bottom: 20px; }
            </style>
          </head>
          <body>
            <div class="success">✅ Authentication Complete!</div>
            <p>You have successfully authorized Tiger Memory CLI access.</p>
            <p><strong>You can now close this window and return to your terminal.</strong></p>
            <p>Your CLI should complete the login process automatically.</p>
          </body>
          </html>
        `);
        return;
      }

      // Check if this is a CLI callback (has callback_port parameter)
      const callbackPort = req.query['callback_port'] as string;
      
      if (callbackPort && !isNaN(parseInt(callbackPort))) {
        // CLI callback: Generate API key and show on success page
        const apiKey = await oauth.generateApiKey(user, 'CLI Login');
        res.redirect(`${baseUrl}/auth/success?mode=cli&username=${user.username}&apiKey=${apiKey.key_hash}&callback_port=${callbackPort}`);
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
    const { mode, username, apiKey, callback_port } = req.query;
    
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

    if (mode === 'cli') {
      html += `
        <p>Your CLI authentication is complete!</p>
        <div class="code">
          <strong>API Key:</strong><br>
          <code id="apiKey">${apiKey}</code>
          <button class="copy-btn" onclick="copyApiKey()">Copy</button>
        </div>
        <div class="warning">
          <strong>⚠️ Important:</strong> Copy this API key - your CLI is waiting for it.
        </div>
        <p><strong>Return to your terminal and the login should complete automatically.</strong></p>
        <p>If it doesn't work automatically, you can manually save this key using:</p>
        <div class="code">tigermemory auth set-key ${apiKey}</div>
        
        <script>
          // Try to send the API key to the local CLI callback
          const callbackPort = '${callback_port}';
          if (callbackPort) {
            const callbackUrl = 'http://localhost:' + callbackPort + '/callback';
            const params = new URLSearchParams({
              apiKey: '${apiKey}',
              username: '${username}',
              email: '${req.query['email'] || ''}'
            });
            
            // Use an image request to avoid CORS issues
            const img = new Image();
            img.onerror = img.onload = () => {
              console.log('Callback attempt made');
            };
            img.src = callbackUrl + '?' + params.toString();
          }
        </script>
      `;
    } else if (mode === 'local') {
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