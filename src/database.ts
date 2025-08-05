import { Pool, QueryResult } from 'pg';
import { logger, TigerMemoryError, errorCodes, logError } from './logger.js';

export interface Decision {
  id?: string;
  project_id: string;
  session_id: string;
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
  started_at?: Date;
  ended_at?: Date;
  decision_count: number;
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

  async createSession(projectId: string): Promise<Session> {
    const query = `
      INSERT INTO sessions (project_id, started_at, decision_count)
      VALUES ($1, NOW(), 0)
      RETURNING *
    `;
    const result = await this.query<Session>(query, [projectId]);
    return result.rows[0]!;
  }

  async updateSessionDecisionCount(sessionId: string, count: number): Promise<void> {
    const query = 'UPDATE sessions SET decision_count = $1 WHERE id = $2';
    await this.query(query, [count, sessionId]);
  }

  async saveDecision(decision: Decision): Promise<Decision> {
    const query = `
      INSERT INTO decisions (
        project_id, session_id, decision, reasoning, type, 
        alternatives_considered, files_affected, confidence, public, 
        vector_embedding, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      RETURNING *
    `;
    const values = [
      decision.project_id,
      decision.session_id,
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
}