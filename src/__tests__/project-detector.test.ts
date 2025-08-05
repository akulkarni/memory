import { ProjectDetector } from '../project-detector';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('fs');
jest.mock('path');

const mockFs = fs as jest.Mocked<typeof fs>;
const mockPath = path as jest.Mocked<typeof path>;

describe('ProjectDetector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generatePathHash', () => {
    it('should generate consistent hash for same path', () => {
      const testPath = '/test/project/path';
      mockPath.resolve.mockReturnValue(testPath);

      const hash1 = ProjectDetector.generatePathHash(testPath);
      const hash2 = ProjectDetector.generatePathHash(testPath);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(16);
      expect(typeof hash1).toBe('string');
    });

    it('should generate different hashes for different paths', () => {
      const path1 = '/test/project/path1';
      const path2 = '/test/project/path2';
      
      mockPath.resolve.mockReturnValueOnce(path1).mockReturnValueOnce(path2);

      const hash1 = ProjectDetector.generatePathHash(path1);
      const hash2 = ProjectDetector.generatePathHash(path2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('detectProject', () => {
    it('should return null when no project is detected', async () => {
      mockPath.resolve.mockReturnValue('/no/project/here');
      mockPath.parse.mockReturnValue({ root: '/' } as any);
      mockPath.dirname.mockReturnValue('/');
      mockFs.readdirSync.mockReturnValue([]);

      const result = await ProjectDetector.detectProject('/no/project/here');

      expect(result).toBeNull();
    });

    it('should detect Node.js project with package.json', async () => {
      const projectRoot = '/test/node/project';
      
      mockPath.resolve.mockReturnValue(projectRoot);
      mockPath.parse.mockReturnValue({ root: '/' } as any);
      mockPath.basename.mockReturnValue('test-project');
      mockPath.join.mockReturnValue(`${projectRoot}/package.json`);
      
      mockFs.readdirSync.mockReturnValue(['package.json', 'src', 'node_modules'] as any);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        name: 'test-project',
        dependencies: {
          express: '^4.18.0',
          typescript: '^5.0.0'
        }
      }));

      const result = await ProjectDetector.detectProject(projectRoot);

      expect(result).not.toBeNull();
      expect(result?.name).toBe('test-project');
      expect(result?.techStack).toContain('javascript');
      expect(result?.techStack).toContain('typescript');
      expect(result?.techStack).toContain('express');
      expect(result?.projectType).toBe('backend');
    });
  });
});