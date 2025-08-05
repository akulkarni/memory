-- Tiger Memory Database Schema
-- Requires PostgreSQL with TimescaleDB and pgvector extensions

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS vector;

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Teams table
CREATE TABLE IF NOT EXISTS teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Team memberships
CREATE TABLE IF NOT EXISTS team_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'member',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, team_id)
);

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    path_hash VARCHAR(64) UNIQUE NOT NULL,
    tech_stack TEXT[] DEFAULT '{}',
    project_type VARCHAR(100) DEFAULT 'general',
    team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sessions table (time-series data)
CREATE TABLE IF NOT EXISTS sessions (
    id UUID DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    decision_count INTEGER DEFAULT 0,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (id, started_at)
);

-- Convert sessions to hypertable (TimescaleDB)
SELECT create_hypertable('sessions', 'started_at', if_not_exists => TRUE);

-- Decisions table (time-series data)
CREATE TABLE IF NOT EXISTS decisions (
    id UUID DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    session_id UUID,
    decision TEXT NOT NULL,
    reasoning TEXT NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('tech_stack', 'architecture', 'pattern', 'tool_choice')),
    alternatives_considered TEXT[] DEFAULT '{}',
    files_affected TEXT[] DEFAULT '{}',
    confidence DECIMAL(3,2) CHECK (confidence >= 0 AND confidence <= 1),
    public BOOLEAN DEFAULT FALSE,
    vector_embedding VECTOR(1536), -- pgvector for semantic search
    created_at TIMESTAMPTZ DEFAULT NOW(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (id, created_at)
);

-- Convert decisions to hypertable (TimescaleDB)
SELECT create_hypertable('decisions', 'created_at', if_not_exists => TRUE);

-- Decision patterns table (time-series data)
CREATE TABLE IF NOT EXISTS decision_patterns (
    id UUID DEFAULT gen_random_uuid(),
    pattern_name VARCHAR(255) NOT NULL,
    description TEXT,
    tech_stack TEXT[] DEFAULT '{}',
    project_type VARCHAR(100),
    usage_count INTEGER DEFAULT 0,
    success_rate DECIMAL(3,2) DEFAULT 0.0 CHECK (success_rate >= 0 AND success_rate <= 1),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
);

-- Convert decision_patterns to hypertable (TimescaleDB)
SELECT create_hypertable('decision_patterns', 'created_at', if_not_exists => TRUE);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_projects_path_hash ON projects(path_hash);
CREATE INDEX IF NOT EXISTS idx_projects_team_id ON projects(team_id);
CREATE INDEX IF NOT EXISTS idx_sessions_project_id ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_decisions_project_id ON decisions(project_id);
CREATE INDEX IF NOT EXISTS idx_decisions_session_id ON decisions(session_id);
CREATE INDEX IF NOT EXISTS idx_decisions_type ON decisions(type);
CREATE INDEX IF NOT EXISTS idx_decisions_created_at ON decisions(created_at);
CREATE INDEX IF NOT EXISTS idx_decisions_public ON decisions(public);

-- Vector similarity search index (pgvector)
CREATE INDEX IF NOT EXISTS idx_decisions_vector_embedding ON decisions 
USING ivfflat (vector_embedding vector_cosine_ops) WITH (lists = 100);

-- Patterns indexes
CREATE INDEX IF NOT EXISTS idx_decision_patterns_tech_stack ON decision_patterns USING GIN(tech_stack);
CREATE INDEX IF NOT EXISTS idx_decision_patterns_project_type ON decision_patterns(project_type);
CREATE INDEX IF NOT EXISTS idx_decision_patterns_usage_count ON decision_patterns(usage_count DESC);

-- Updated at triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_teams_updated_at ON teams;
CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON teams
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_projects_updated_at ON projects;
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_decision_patterns_updated_at ON decision_patterns;
CREATE TRIGGER update_decision_patterns_updated_at BEFORE UPDATE ON decision_patterns
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();