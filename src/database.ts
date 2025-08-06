import { Pool, QueryResult } from 'pg';
import { logger, TigerMemoryError, errorCodes, logError } from './logger';

export interface Decision {
  id?: string;
  project_id: string;
  session_id: string;
  user_id?: string;
  decision: string;
  reasoning: string;
  type: 'tech_stack' | 'architecture' | 'pattern' | 'tool_choice';
  alternatives_considered: string[];
  files_affected: string[];
  confidence: number;
  public: boolean;
  vector_embedding?: number[];
  created_at?: Date;
}

export interface DecisionPattern {
  id?: string;
  pattern_name: string;
  description: string;
  tech_stack: string[];
  usage_count: number;
  success_rate: number;
  created_at?: Date;
}

export interface Project {
  id?: string;
  name: string;
  path_hash: string;
  tech_stack: string[];
  project_type: string;
  created_at?: Date;
}

export interface Session {
  id?: string;
  project_id: string;
  user_id?: string;
  started_at?: Date;
  ended_at?: Date;
  decision_count: number;
}

export interface User {
  id?: string;
  github_id: number;
  email: string;
  username: string;
  name: string | null;
  avatar_url: string;
  created_at?: Date;
}

export interface ApiKey {
  id?: string;
  user_id: string;
  key_hash: string;
  name: string;
  last_used_at?: Date;
  created_at?: Date;
}

export class TigerCloudDB {
  private pool: Pool;
  private isConnected: boolean = false;

  constructor() {
    const connectionString = process.env['TIGER_CLOUD_CONNECTION_STRING'];
    if (!connectionString) {
      throw new TigerMemoryError(
        'TIGER_CLOUD_CONNECTION_STRING environment variable is required',
        errorCodes.MISSING_CONFIG,
        500
      );
    }

    this.pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    this.pool.on('error', (err: Error) => {
      logError(err, { context: 'database_pool_idle_client' });
    });
  }

  async connect(): Promise<void> {
    try {
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();
      this.isConnected = true;
      logger.info('Connected to Tiger Cloud database');
    } catch (error) {
      logError(error as Error, { context: 'database_connection' });
      throw new TigerMemoryError(
        'Failed to connect to Tiger Cloud database',
        errorCodes.DB_CONNECTION_FAILED,
        500,
        { originalError: error }
      );
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.pool.end();
      this.isConnected = false;
      logger.info('Disconnected from Tiger Cloud database');
    } catch (error) {
      logError(error as Error, { context: 'database_disconnection' });
    }
  }

  private async query<T extends Record<string, any> = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
    if (!this.isConnected) {
      await this.connect();
    }

    const start = Date.now();
    try {
      const result = await this.pool.query<T>(text, params);
      const duration = Date.now() - start;
      logger.debug('Executed query', { 
        text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        duration, 
        rows: result.rowCount 
      });
      return result;
    } catch (error) {
      logError(error as Error, { 
        context: 'database_query',
        query: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        params: params?.slice(0, 5) // Only log first 5 params for security
      });
      throw new TigerMemoryError(
        'Database query failed',
        errorCodes.DB_QUERY_FAILED,
        500,
        { query: text, originalError: error }
      );
    }
  }

  async createProject(project: Project): Promise<Project> {
    const query = `
      INSERT INTO projects (name, path_hash, tech_stack, project_type, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      RETURNING *
    `;
    const values = [project.name, project.path_hash, project.tech_stack, project.project_type];
    const result = await this.query<Project>(query, values);
    return result.rows[0]!;
  }

  async getProject(pathHash: string): Promise<Project | null> {
    const query = 'SELECT * FROM projects WHERE path_hash = $1';
    const result = await this.query<Project>(query, [pathHash]);
    return result.rows[0] || null;
  }

  async createSession(projectId: string, userId?: string): Promise<Session> {
    const query = `
      INSERT INTO sessions (project_id, user_id, started_at, decision_count)
      VALUES ($1, $2, NOW(), 0)
      RETURNING *
    `;
    const result = await this.query<Session>(query, [projectId, userId || null]);
    return result.rows[0]!;
  }

  async updateSessionDecisionCount(sessionId: string, count: number): Promise<void> {
    const query = 'UPDATE sessions SET decision_count = $1 WHERE id = $2';
    await this.query(query, [count, sessionId]);
  }

  async saveDecision(decision: Decision): Promise<Decision> {
    const query = `
      INSERT INTO decisions (
        project_id, session_id, user_id, decision, reasoning, type, 
        alternatives_considered, files_affected, confidence, public, 
        vector_embedding, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      RETURNING *
    `;
    const values = [
      decision.project_id,
      decision.session_id,
      decision.user_id || null,
      decision.decision,
      decision.reasoning,
      decision.type,
      decision.alternatives_considered,
      decision.files_affected,
      decision.confidence,
      decision.public,
      decision.vector_embedding ? `[${decision.vector_embedding.join(',')}]` : null
    ];
    const result = await this.query<Decision>(query, values);
    return result.rows[0]!;
  }

  async getProjectDecisions(projectId: string, limit: number = 10): Promise<Decision[]> {
    const query = `
      SELECT * FROM decisions 
      WHERE project_id = $1 
      ORDER BY created_at DESC 
      LIMIT $2
    `;
    const result = await this.query<Decision>(query, [projectId, limit]);
    return result.rows;
  }

  async searchDecisionsByVector(
    embedding: number[], 
    projectId?: string, 
    limit: number = 10
  ): Promise<Decision[]> {
    const embeddingString = `[${embedding.join(',')}]`;
    let query: string;
    let params: any[];

    if (projectId) {
      query = `
        SELECT *, vector_embedding <-> $1::vector as distance
        FROM decisions 
        WHERE project_id = $2 AND vector_embedding IS NOT NULL
        ORDER BY vector_embedding <-> $1::vector
        LIMIT $3
      `;
      params = [embeddingString, projectId, limit];
    } else {
      query = `
        SELECT *, vector_embedding <-> $1::vector as distance
        FROM decisions 
        WHERE public = true AND vector_embedding IS NOT NULL
        ORDER BY vector_embedding <-> $1::vector
        LIMIT $2
      `;
      params = [embeddingString, limit];
    }

    const result = await this.query<Decision & { distance: number }>(query, params);
    return result.rows;
  }

  async getDecisionTimeline(
    projectId: string, 
    since?: Date, 
    category?: string
  ): Promise<Decision[]> {
    let query = `
      SELECT * FROM decisions 
      WHERE project_id = $1
    `;
    const params: any[] = [projectId];
    let paramCount = 1;

    if (since) {
      paramCount++;
      query += ` AND created_at >= $${paramCount}`;
      params.push(since);
    }

    if (category) {
      paramCount++;
      query += ` AND type = $${paramCount}`;
      params.push(category);
    }

    query += ' ORDER BY created_at ASC';

    const result = await this.query<Decision>(query, params);
    return result.rows;
  }

  async getArchitecturalPatterns(
    techStack?: string[], 
    projectType?: string, 
    limit: number = 10
  ): Promise<DecisionPattern[]> {
    let query = `
      SELECT * FROM decision_patterns
      WHERE usage_count > 0
    `;
    const params: any[] = [];
    let paramCount = 0;

    if (techStack && techStack.length > 0) {
      paramCount++;
      query += ` AND tech_stack && $${paramCount}`;
      params.push(techStack);
    }

    if (projectType) {
      paramCount++;
      query += ` AND $${paramCount} = ANY(ARRAY['general', $${paramCount}])`;
      params.push(projectType);
    }

    query += ` ORDER BY usage_count DESC, success_rate DESC LIMIT $${paramCount + 1}`;
    params.push(limit);

    const result = await this.query<DecisionPattern>(query, params);
    return result.rows;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  // User management methods
  async createUser(userData: Omit<User, 'id' | 'created_at'>): Promise<User> {
    const query = `
      INSERT INTO users (github_id, email, username, name, avatar_url, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING *
    `;
    const values = [userData.github_id, userData.email, userData.username, userData.name, userData.avatar_url];
    const result = await this.query<User>(query, values);
    return result.rows[0]!;
  }

  async getUserById(userId: string): Promise<User | null> {
    const query = 'SELECT * FROM users WHERE id = $1';
    const result = await this.query<User>(query, [userId]);
    return result.rows[0] || null;
  }

  async getUserByGitHubId(githubId: number): Promise<User | null> {
    const query = 'SELECT * FROM users WHERE github_id = $1';
    const result = await this.query<User>(query, [githubId]);
    return result.rows[0] || null;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const query = 'SELECT * FROM users WHERE email = $1';
    const result = await this.query<User>(query, [email]);
    return result.rows[0] || null;
  }

  async updateUser(userId: string, updates: Partial<Omit<User, 'id' | 'github_id' | 'created_at'>>): Promise<User> {
    const fields = Object.keys(updates).filter(key => updates[key as keyof typeof updates] !== undefined);
    const setClause = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');
    const values = [userId, ...fields.map(field => updates[field as keyof typeof updates])];

    const query = `
      UPDATE users 
      SET ${setClause}, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;
    const result = await this.query<User>(query, values);
    return result.rows[0]!;
  }

  // API Key management methods
  async createApiKey(apiKeyData: Omit<ApiKey, 'id' | 'created_at' | 'last_used_at'>): Promise<ApiKey> {
    const query = `
      INSERT INTO api_keys (user_id, key_hash, name, created_at)
      VALUES ($1, $2, $3, NOW())
      RETURNING *
    `;
    const values = [apiKeyData.user_id, apiKeyData.key_hash, apiKeyData.name];
    const result = await this.query<ApiKey>(query, values);
    return result.rows[0]!;
  }

  async getApiKeyByHash(keyHash: string): Promise<ApiKey | null> {
    const query = 'SELECT * FROM api_keys WHERE key_hash = $1';
    const result = await this.query<ApiKey>(query, [keyHash]);
    return result.rows[0] || null;
  }

  async updateApiKeyLastUsed(apiKeyId: string): Promise<void> {
    const query = 'UPDATE api_keys SET last_used_at = NOW() WHERE id = $1';
    await this.query(query, [apiKeyId]);
  }

  async getUserApiKeys(userId: string): Promise<ApiKey[]> {
    const query = 'SELECT * FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC';
    const result = await this.query<ApiKey>(query, [userId]);
    return result.rows;
  }

  async deleteApiKey(apiKeyId: string, userId: string): Promise<boolean> {
    const query = 'DELETE FROM api_keys WHERE id = $1 AND user_id = $2';
    const result = await this.query(query, [apiKeyId, userId]);
    return result.rowCount! > 0;
  }
}