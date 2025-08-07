-- Migration: Add Git-based project identification
-- This migration adds support for identifying projects by Git remote URLs
-- instead of just local file paths, enabling cross-user project collaboration

-- Add new columns to projects table
ALTER TABLE projects ADD COLUMN IF NOT EXISTS git_remote_url VARCHAR(500);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS repository_id VARCHAR(200);

-- Create index for efficient repository_id lookups
CREATE INDEX IF NOT EXISTS idx_projects_repository_id ON projects(repository_id);

-- Update the existing unique constraint to include both path_hash and repository_id
-- We'll keep path_hash for backward compatibility and non-Git projects
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_path_hash_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_unique_identifier 
ON projects(COALESCE(repository_id, path_hash));

-- Add comments for documentation
COMMENT ON COLUMN projects.git_remote_url IS 'Full Git remote URL (e.g., https://github.com/user/repo.git)';
COMMENT ON COLUMN projects.repository_id IS 'Normalized repository identifier (e.g., github.com/user/repo)';
COMMENT ON INDEX idx_projects_repository_id IS 'Index for fast repository_id lookups';
COMMENT ON INDEX idx_projects_unique_identifier IS 'Ensures uniqueness by repository_id or path_hash fallback';