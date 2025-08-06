import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import http from 'http';

interface AuthConfig {
  apiKey?: string;
  userId?: string;
  username?: string | undefined;
  email?: string | undefined;
  loginUrl?: string;
}

export class AuthManager {
  private configDir: string;
  private configPath: string;

  constructor() {
    this.configDir = path.join(os.homedir(), '.tigermemory');
    this.configPath = path.join(this.configDir, 'auth.json');
  }

  private ensureConfigDir(): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
  }

  private loadConfig(): AuthConfig {
    if (!fs.existsSync(this.configPath)) {
      return {};
    }
    
    try {
      const content = fs.readFileSync(this.configPath, 'utf8');
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  private saveConfig(config: AuthConfig): void {
    this.ensureConfigDir();
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
  }

  public getApiKey(): string | null {
    const config = this.loadConfig();
    return config.apiKey || null;
  }

  public getUser(): { username?: string | undefined; email?: string | undefined } | null {
    const config = this.loadConfig();
    if (config.username || config.email) {
      return {
        username: config.username,
        email: config.email
      };
    }
    return null;
  }

  public isLoggedIn(): boolean {
    return !!this.getApiKey();
  }

  public logout(): void {
    if (fs.existsSync(this.configPath)) {
      fs.unlinkSync(this.configPath);
    }
  }

  public setApiKey(apiKey: string, username?: string, email?: string): void {
    const config: AuthConfig = {
      apiKey,
      username: username || 'manual-setup',
      email,
      loginUrl: 'https://tigermemory.onrender.com'
    };
    this.saveConfig(config);
  }

  public async login(options: { local?: boolean; baseUrl?: string } = {}): Promise<void> {
    const baseUrl = options.local 
      ? 'http://localhost:3000' 
      : (options.baseUrl || 'https://tigermemory.onrender.com');

    // Start temporary local server to capture callback
    const callbackPort = await this.findAvailablePort(8080);
    const loginUrl = `${baseUrl}/auth/github?callback_port=${callbackPort}`;

    console.log('🔐 Starting Tiger Memory authentication...');
    console.log(`Opening browser to: ${loginUrl}`);
    
    // Open browser
    this.openBrowser(loginUrl);
    
    // Wait for callback with API key
    const result = await this.waitForCallback(callbackPort);
    
    if (result.success && result.apiKey) {
      // Save auth config
      const config: AuthConfig = {
        apiKey: result.apiKey,
        username: result.username,
        email: result.email,
        loginUrl: baseUrl
      };
      
      this.saveConfig(config);
      
      console.log(`✅ Successfully logged in as @${result.username}`);
      console.log(`🔑 API key saved to ${this.configPath}`);
    } else {
      throw new Error(result.error || 'Login failed');
    }
  }

  private async findAvailablePort(startPort: number): Promise<number> {
    return new Promise((resolve) => {
      const server = http.createServer();
      server.listen(startPort, () => {
        const port = (server.address() as any)?.port || startPort;
        server.close();
        resolve(port);
      });
      server.on('error', () => {
        resolve(this.findAvailablePort(startPort + 1));
      });
    });
  }

  private openBrowser(url: string): void {
    const platform = os.platform();
    let command: string;
    
    switch (platform) {
      case 'darwin':
        command = 'open';
        break;
      case 'win32':
        command = 'start';
        break;
      default:
        command = 'xdg-open';
        break;
    }
    
    spawn(command, [url], { detached: true, stdio: 'ignore' });
  }

  private async waitForCallback(port: number): Promise<{
    success: boolean;
    apiKey?: string;
    username?: string;
    email?: string | undefined;
    error?: string;
  }> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url!, `http://localhost:${port}`);
        
        if (url.pathname === '/callback') {
          const apiKey = url.searchParams.get('apiKey');
          const username = url.searchParams.get('username');
          const email = url.searchParams.get('email') || undefined;
          const error = url.searchParams.get('error');
          
          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <body>
                  <h1>❌ Authentication Failed</h1>
                  <p>Error: ${error}</p>
                  <p>You can close this window.</p>
                </body>
              </html>
            `);
            server.close();
            resolve({ success: false, error });
          } else if (apiKey && username) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <body>
                  <h1>✅ Successfully Authenticated!</h1>
                  <p>Welcome, @${username}!</p>
                  <p>You can now close this window and return to your terminal.</p>
                  <script>
                    setTimeout(() => window.close(), 3000);
                  </script>
                </body>
              </html>
            `);
            server.close();
            resolve({ 
              success: true, 
              apiKey, 
              username, 
              email 
            });
          } else {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <body>
                  <h1>❌ Invalid Response</h1>
                  <p>Missing required authentication data.</p>
                  <p>You can close this window.</p>
                </body>
              </html>
            `);
            server.close();
            resolve({ success: false, error: 'Missing authentication data' });
          }
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });

      server.listen(port, () => {
        console.log(`Waiting for authentication callback on port ${port}...`);
      });

      server.on('error', (err) => {
        reject(new Error(`Failed to start callback server: ${err.message}`));
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        server.close();
        reject(new Error('Authentication timeout - please try again'));
      }, 5 * 60 * 1000);
    });
  }
}