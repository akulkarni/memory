import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { createLogger } from 'winston';

const logger = createLogger({
  level: 'info',
  format: require('winston').format.combine(
    require('winston').format.timestamp(),
    require('winston').format.json()
  ),
  transports: [
    new (require('winston').transports.Console)()
  ]
});

export interface ProjectInfo {
  name: string;
  rootPath: string;
  pathHash: string;
  gitRemoteUrl?: string;
  repositoryId?: string;
  techStack: string[];
  projectType: string;
}

export class ProjectDetector {
  private static readonly PROJECT_FILES = [
    'package.json',
    'pyproject.toml',
    'requirements.txt',
    'Cargo.toml',
    'go.mod',
    'pom.xml',
    'build.gradle',
    'composer.json',
    'Gemfile',
    'mix.exs',
    'deno.json',
    'bun.lockb'
  ];

  private static readonly VERSION_CONTROL_DIRS = ['.git', '.hg', '.svn'];

  static async detectProject(startPath: string = process.cwd()): Promise<ProjectInfo | null> {
    try {
      const rootPath = this.findProjectRoot(startPath);
      if (!rootPath) {
        logger.warn('No project root found', { startPath });
        return null;
      }

      const name = this.extractProjectName(rootPath);
      const pathHash = this.generatePathHash(rootPath);
      const gitInfo = this.extractGitInfo(rootPath);
      const techStack = await this.analyzeTechStack(rootPath);
      const projectType = this.determineProjectType(techStack, rootPath);

      const projectInfo: ProjectInfo = {
        name,
        rootPath,
        pathHash,
        ...(gitInfo.remoteUrl && { gitRemoteUrl: gitInfo.remoteUrl }),
        ...(gitInfo.repositoryId && { repositoryId: gitInfo.repositoryId }),
        techStack,
        projectType
      };

      logger.info('Project detected', projectInfo);
      return projectInfo;
    } catch (error) {
      logger.error('Error detecting project', { error, startPath });
      return null;
    }
  }

  private static findProjectRoot(startPath: string): string | null {
    let currentPath = path.resolve(startPath);
    const rootPath = path.parse(currentPath).root;

    while (currentPath !== rootPath) {
      if (this.isProjectRoot(currentPath)) {
        return currentPath;
      }
      currentPath = path.dirname(currentPath);
    }

    return null;
  }

  private static isProjectRoot(dirPath: string): boolean {
    try {
      const entries = fs.readdirSync(dirPath);
      
      const hasProjectFile = this.PROJECT_FILES.some(file => 
        entries.includes(file)
      );
      
      const hasVersionControl = this.VERSION_CONTROL_DIRS.some(dir => 
        entries.includes(dir) && fs.statSync(path.join(dirPath, dir)).isDirectory()
      );

      return hasProjectFile || hasVersionControl;
    } catch {
      return false;
    }
  }

  private static extractProjectName(rootPath: string): string {
    const packageJsonPath = path.join(rootPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        if (packageJson.name) {
          return packageJson.name;
        }
      } catch {
        // Fall through to directory name
      }
    }

    const cargoTomlPath = path.join(rootPath, 'Cargo.toml');
    if (fs.existsSync(cargoTomlPath)) {
      try {
        const cargoContent = fs.readFileSync(cargoTomlPath, 'utf-8');
        const nameMatch = cargoContent.match(/name\s*=\s*"([^"]+)"/);
        if (nameMatch) {
          return nameMatch[1]!;
        }
      } catch {
        // Fall through to directory name
      }
    }

    const pyprojectPath = path.join(rootPath, 'pyproject.toml');
    if (fs.existsSync(pyprojectPath)) {
      try {
        const pyprojectContent = fs.readFileSync(pyprojectPath, 'utf-8');
        const nameMatch = pyprojectContent.match(/name\s*=\s*"([^"]+)"/);
        if (nameMatch) {
          return nameMatch[1]!;
        }
      } catch {
        // Fall through to directory name
      }
    }

    return path.basename(rootPath);
  }

  static generatePathHash(projectPath: string): string {
    const normalizedPath = path.resolve(projectPath);
    return createHash('sha256').update(normalizedPath).digest('hex').substring(0, 16);
  }

  private static extractGitInfo(rootPath: string): { remoteUrl?: string; repositoryId?: string } {
    try {
      // Check if this is a Git repository
      const gitDir = path.join(rootPath, '.git');
      if (!fs.existsSync(gitDir)) {
        return {};
      }

      // Get the remote origin URL
      const remoteUrl = execSync('git config --get remote.origin.url', {
        cwd: rootPath,
        encoding: 'utf8',
        timeout: 5000 // 5 second timeout
      }).trim();

      if (!remoteUrl) {
        return {};
      }

      const repositoryId = this.normalizeGitUrl(remoteUrl);
      
      logger.debug('Git info extracted', { rootPath, remoteUrl, repositoryId });
      return { remoteUrl, repositoryId };
    } catch (error) {
      // Git command failed or not a Git repository
      logger.debug('Failed to extract Git info', { rootPath, error: (error as Error).message });
      return {};
    }
  }

  private static normalizeGitUrl(gitUrl: string): string {
    // Remove common prefixes and suffixes to get a normalized repository identifier
    let normalized = gitUrl.trim();
    
    // Handle SSH format: git@github.com:user/repo.git -> github.com/user/repo
    if (normalized.startsWith('git@')) {
      normalized = normalized.replace(/^git@/, '');
      normalized = normalized.replace(':', '/');
    }
    
    // Handle HTTPS format: https://github.com/user/repo.git -> github.com/user/repo
    if (normalized.startsWith('https://') || normalized.startsWith('http://')) {
      normalized = normalized.replace(/^https?:\/\//, '');
    }
    
    // Remove .git suffix
    if (normalized.endsWith('.git')) {
      normalized = normalized.slice(0, -4);
    }
    
    // Remove trailing slash
    if (normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }
    
    return normalized.toLowerCase();
  }

  private static async analyzeTechStack(rootPath: string): Promise<string[]> {
    const techStack: Set<string> = new Set();

    const packageJsonPath = path.join(rootPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      techStack.add('javascript');
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        
        if (packageJson.dependencies || packageJson.devDependencies) {
          const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };
          
          if (allDeps.typescript || allDeps['@types/node']) techStack.add('typescript');
          if (allDeps.react) techStack.add('react');
          if (allDeps.vue) techStack.add('vue');
          if (allDeps.angular || allDeps['@angular/core']) techStack.add('angular');
          if (allDeps.express) techStack.add('express');
          if (allDeps.next || allDeps['next.js']) techStack.add('nextjs');
          if (allDeps.svelte) techStack.add('svelte');
          if (allDeps.nuxt) techStack.add('nuxt');
          if (allDeps.fastify) techStack.add('fastify');
          if (allDeps.nestjs || allDeps['@nestjs/core']) techStack.add('nestjs');
          if (allDeps.gatsby) techStack.add('gatsby');
          if (allDeps.electron) techStack.add('electron');
          if (allDeps.jest) techStack.add('jest');
          if (allDeps.mocha) techStack.add('mocha');
          if (allDeps.webpack) techStack.add('webpack');
          if (allDeps.vite) techStack.add('vite');
          if (allDeps.tailwindcss) techStack.add('tailwindcss');
        }
      } catch {
        // Continue with basic javascript detection
      }
    }

    if (fs.existsSync(path.join(rootPath, 'requirements.txt')) || 
        fs.existsSync(path.join(rootPath, 'pyproject.toml')) ||
        fs.existsSync(path.join(rootPath, 'setup.py'))) {
      techStack.add('python');
      
      if (fs.existsSync(path.join(rootPath, 'manage.py'))) techStack.add('django');
      if (fs.existsSync(path.join(rootPath, 'app.py')) || 
          fs.existsSync(path.join(rootPath, 'main.py'))) {
        const requirementsPath = path.join(rootPath, 'requirements.txt');
        if (fs.existsSync(requirementsPath)) {
          const requirements = fs.readFileSync(requirementsPath, 'utf-8');
          if (requirements.includes('flask')) techStack.add('flask');
          if (requirements.includes('fastapi')) techStack.add('fastapi');
          if (requirements.includes('streamlit')) techStack.add('streamlit');
        }
      }
    }

    if (fs.existsSync(path.join(rootPath, 'Cargo.toml'))) {
      techStack.add('rust');
    }

    if (fs.existsSync(path.join(rootPath, 'go.mod'))) {
      techStack.add('go');
    }

    if (fs.existsSync(path.join(rootPath, 'pom.xml')) || 
        fs.existsSync(path.join(rootPath, 'build.gradle'))) {
      techStack.add('java');
      if (fs.existsSync(path.join(rootPath, 'build.gradle'))) techStack.add('gradle');
      if (fs.existsSync(path.join(rootPath, 'pom.xml'))) techStack.add('maven');
    }

    if (fs.existsSync(path.join(rootPath, 'composer.json'))) {
      techStack.add('php');
    }

    if (fs.existsSync(path.join(rootPath, 'Gemfile'))) {
      techStack.add('ruby');
      techStack.add('rails');
    }

    if (fs.existsSync(path.join(rootPath, 'mix.exs'))) {
      techStack.add('elixir');
    }

    if (fs.existsSync(path.join(rootPath, 'deno.json'))) {
      techStack.add('deno');
    }

    if (fs.existsSync(path.join(rootPath, 'docker-compose.yml')) || 
        fs.existsSync(path.join(rootPath, 'Dockerfile'))) {
      techStack.add('docker');
    }

    if (fs.existsSync(path.join(rootPath, '.github'))) {
      techStack.add('github-actions');
    }

    if (fs.existsSync(path.join(rootPath, 'terraform'))) {
      techStack.add('terraform');
    }

    return Array.from(techStack);
  }

  private static determineProjectType(techStack: string[], rootPath: string): string {
    if (techStack.includes('react') || techStack.includes('vue') || techStack.includes('angular')) {
      return 'frontend';
    }
    
    if (techStack.includes('express') || techStack.includes('fastapi') || 
        techStack.includes('django') || techStack.includes('rails')) {
      return 'backend';
    }
    
    if (techStack.includes('nextjs') || techStack.includes('nuxt') || techStack.includes('gatsby')) {
      return 'fullstack';
    }
    
    if (techStack.includes('electron') || techStack.includes('tauri')) {
      return 'desktop';
    }
    
    if (techStack.includes('react-native') || techStack.includes('flutter')) {
      return 'mobile';
    }
    
    if (fs.existsSync(path.join(rootPath, 'lib')) && 
        (techStack.includes('javascript') || techStack.includes('typescript'))) {
      return 'library';
    }
    
    if (techStack.includes('rust') || techStack.includes('go') || techStack.includes('c++')) {
      return 'systems';
    }
    
    if (techStack.includes('python') && 
        (fs.existsSync(path.join(rootPath, 'notebooks')) || 
         fs.existsSync(path.join(rootPath, 'data')))) {
      return 'data-science';
    }

    return 'general';
  }
}