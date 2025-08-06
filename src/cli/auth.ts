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

    console.log('🔐 Starting Tiger Memory authentication...');
    
    // Start device flow
    console.log('📱 Requesting device authorization...');
    const deviceResponse = await this.startDeviceFlow(baseUrl);
    
    console.log(`\n🌐 Please visit: ${deviceResponse.verification_uri}`);
    console.log(`🔢 Enter this code: ${deviceResponse.user_code}`);
    console.log('\n⏳ Waiting for you to complete authentication...\n');
    
    // Open browser automatically
    this.openBrowser(deviceResponse.verification_uri);
    
    // Poll for completion
    const result = await this.pollForToken(baseUrl, deviceResponse.device_code);
    
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

  private async startDeviceFlow(baseUrl: string): Promise<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  }> {
    const response = await fetch(`${baseUrl}/auth/device`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Device flow failed: ${response.statusText}`);
    }

    return await response.json() as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      expires_in: number;
      interval: number;
    };
  }

  private async pollForToken(baseUrl: string, deviceCode: string): Promise<{
    success: boolean;
    apiKey?: string;
    username?: string;
    email?: string;
    error?: string;
  }> {
    const maxAttempts = 60; // 5 minutes with 5-second intervals
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const response = await fetch(`${baseUrl}/auth/device/token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ device_code: deviceCode }),
        });

        const data = await response.json() as any;

        if (response.ok && data.apiKey) {
          return {
            success: true,
            apiKey: data.apiKey,
            username: data.username,
            email: data.email,
          };
        } else if (data.error === 'authorization_pending') {
          // Still waiting for user to authorize
          process.stdout.write('.');
          await new Promise(resolve => setTimeout(resolve, 5000));
          attempts++;
          continue;
        } else {
          return {
            success: false,
            error: data.error || 'Unknown error',
          };
        }
      } catch (error) {
        return {
          success: false,
          error: `Network error: ${error instanceof Error ? error.message : 'Unknown'}`,
        };
      }
    }

    return {
      success: false,
      error: 'Authentication timeout - please try again',
    };
  }

}