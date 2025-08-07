import Anthropic from '@anthropic-ai/sdk';
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

export interface EmbeddingResult {
  embedding: number[];
  text: string;
}

export class ArchitecturalIntelligence {
  private anthropic: Anthropic;

  constructor() {
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required');
    }

    this.anthropic = new Anthropic({
      apiKey: apiKey,
    });
  }

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      logger.info('Starting embedding generation', { textLength: text.length });
      
      // Add timeout to prevent hanging
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Embedding generation timeout')), 15000);
      });
      
      // Since Anthropic doesn't have a direct embeddings API, we'll use Claude to generate
      // semantic features and convert them to a vector representation
      const embeddingPromise = this.anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `Analyze this text and extract 20 key semantic features as numbers between -1 and 1. Return only a JSON array of 20 floating point numbers, nothing else.

Text: "${text}"`
        }]
      });
      
      const response = await Promise.race([embeddingPromise, timeoutPromise]);
      logger.info('Embedding generation completed');

      const content = response.content[0];
      if (!content || content.type !== 'text') {
        throw new Error('Unexpected response format from Anthropic');
      }

      const embedding = JSON.parse(content.text);
      
      if (!Array.isArray(embedding) || embedding.length !== 20) {
        throw new Error('Invalid embedding format from Anthropic');
      }

      // Pad to standard embedding size (1536) for compatibility
      const paddedEmbedding = new Array(1536).fill(0);
      embedding.forEach((val: number, idx: number) => {
        if (idx < 20) {
          paddedEmbedding[idx] = val;
        }
      });

      return paddedEmbedding;
    } catch (error) {
      logger.error('Failed to generate embedding via Anthropic, using fallback', { error: error instanceof Error ? error.message : String(error), textLength: text.length });
      
      // Fallback: generate a simple deterministic embedding based on text content
      return this.generateFallbackEmbedding(text);
    }
  }

  private generateFallbackEmbedding(text: string): number[] {
    // Create a deterministic embedding based on text characteristics
    const paddedEmbedding = new Array(1536).fill(0);
    
    // Simple hash-based features
    let hash1 = 0, hash2 = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash1 = ((hash1 << 5) - hash1) + char;
      hash2 = ((hash2 << 3) - hash2) + char;
      hash1 |= 0; // Convert to 32bit integer
      hash2 |= 0; // Convert to 32bit integer
    }
    
    // Fill first 20 positions with normalized features
    paddedEmbedding[0] = (hash1 % 1000) / 1000; // Text hash feature
    paddedEmbedding[1] = (hash2 % 1000) / 1000; // Alternative hash
    paddedEmbedding[2] = Math.min(text.length / 1000, 1); // Length feature
    paddedEmbedding[3] = (text.split(' ').length / 100); // Word count feature
    paddedEmbedding[4] = (text.split('\n').length / 10); // Line count feature
    
    // Add some randomness based on text content for remaining positions
    for (let i = 5; i < 20; i++) {
      const seed = hash1 + hash2 + i;
      paddedEmbedding[i] = ((seed % 2000) - 1000) / 1000; // Random-ish value between -1 and 1
    }
    
    logger.info('Generated fallback embedding', { textLength: text.length });
    return paddedEmbedding;
  }

  async generateDecisionEmbedding(decision: string, reasoning: string, type: string): Promise<number[]> {
    const combinedText = `${type}: ${decision}\n\nReasoning: ${reasoning}`;
    return this.generateEmbedding(combinedText);
  }

  async generateQueryEmbedding(query: string): Promise<number[]> {
    return this.generateEmbedding(query);
  }

  extractPatterns(decisions: Array<{ decision: string; reasoning: string; type: string }>): Array<{
    pattern: string;
    frequency: number;
    examples: string[];
  }> {
    const patternMap = new Map<string, { count: number; examples: Set<string> }>();

    for (const decision of decisions) {
      const patterns = this.identifyPatterns(decision);
      
      for (const pattern of patterns) {
        if (!patternMap.has(pattern)) {
          patternMap.set(pattern, { count: 0, examples: new Set() });
        }
        
        const entry = patternMap.get(pattern)!;
        entry.count++;
        entry.examples.add(decision.decision);
      }
    }

    return Array.from(patternMap.entries())
      .map(([pattern, data]) => ({
        pattern,
        frequency: data.count,
        examples: Array.from(data.examples).slice(0, 3)
      }))
      .sort((a, b) => b.frequency - a.frequency);
  }

  private identifyPatterns(decision: { decision: string; reasoning: string; type: string }): string[] {
    const patterns: string[] = [];
    const text = `${decision.decision} ${decision.reasoning}`.toLowerCase();

    const commonPatterns = [
      // Architecture patterns
      { pattern: 'microservices', keywords: ['microservice', 'service-oriented', 'distributed'] },
      { pattern: 'monolithic', keywords: ['monolith', 'single application', 'all-in-one'] },
      { pattern: 'serverless', keywords: ['lambda', 'functions', 'serverless', 'faas'] },
      { pattern: 'event-driven', keywords: ['event', 'message queue', 'pub/sub', 'kafka'] },
      { pattern: 'restful-api', keywords: ['rest', 'restful', 'http api', 'web api'] },
      { pattern: 'graphql', keywords: ['graphql', 'graph query'] },
      
      // Database patterns
      { pattern: 'sql-database', keywords: ['postgres', 'mysql', 'sqlite', 'sql'] },
      { pattern: 'nosql-database', keywords: ['mongodb', 'redis', 'dynamodb', 'nosql'] },
      { pattern: 'caching', keywords: ['cache', 'redis', 'memcached', 'caching layer'] },
      
      // Frontend patterns
      { pattern: 'spa', keywords: ['single page', 'spa', 'client-side routing'] },
      { pattern: 'ssr', keywords: ['server-side rendering', 'ssr', 'next.js', 'nuxt'] },
      { pattern: 'component-based', keywords: ['component', 'react', 'vue', 'angular'] },
      
      // DevOps patterns
      { pattern: 'containerization', keywords: ['docker', 'container', 'kubernetes'] },
      { pattern: 'ci-cd', keywords: ['continuous integration', 'continuous deployment', 'ci/cd', 'pipeline'] },
      { pattern: 'infrastructure-as-code', keywords: ['terraform', 'cloudformation', 'iac'] },
      
      // Security patterns
      { pattern: 'authentication', keywords: ['auth', 'jwt', 'oauth', 'login'] },
      { pattern: 'authorization', keywords: ['permissions', 'rbac', 'access control'] },
      { pattern: 'api-security', keywords: ['api key', 'rate limiting', 'cors'] },
    ];

    for (const { pattern, keywords } of commonPatterns) {
      if (keywords.some(keyword => text.includes(keyword))) {
        patterns.push(pattern);
      }
    }

    return patterns;
  }

  calculateSimilarity(embedding1: number[], embedding2: number[]): number {
    if (embedding1.length !== embedding2.length) {
      throw new Error('Embeddings must have the same length');
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i]! * embedding2[i]!;
      norm1 += embedding1[i]! * embedding1[i]!;
      norm2 += embedding2[i]! * embedding2[i]!;
    }

    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  rankPatternsByRelevance(
    patterns: Array<{ pattern: string; frequency: number; examples: string[] }>,
    query: string
  ): Array<{ pattern: string; frequency: number; examples: string[]; relevance: number }> {
    const queryLower = query.toLowerCase();
    
    return patterns.map(pattern => {
      let relevance = 0;
      
      if (pattern.pattern.toLowerCase().includes(queryLower)) {
        relevance += 0.5;
      }
      
      const exampleMatches = pattern.examples.filter(example => 
        example.toLowerCase().includes(queryLower)
      ).length;
      relevance += (exampleMatches / pattern.examples.length) * 0.3;
      
      relevance += Math.log(pattern.frequency + 1) * 0.2;
      
      return { ...pattern, relevance };
    }).sort((a, b) => b.relevance - a.relevance);
  }

  generateArchitecturalSummary(decisions: Array<{
    decision: string;
    reasoning: string;
    type: string;
    created_at?: Date;
  }>): string {
    if (decisions.length === 0) {
      return 'No architectural decisions found for this project.';
    }

    const patterns = this.extractPatterns(decisions);
    const recentDecisions = decisions
      .sort((a, b) => (b.created_at?.getTime() || 0) - (a.created_at?.getTime() || 0))
      .slice(0, 5);

    const typeCount = decisions.reduce((acc, d) => {
      acc[d.type] = (acc[d.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    let summary = `## Project Architecture Summary\n\n`;
    summary += `**Total Decisions:** ${decisions.length}\n\n`;
    
    summary += `**Decision Types:**\n`;
    Object.entries(typeCount).forEach(([type, count]) => {
      summary += `- ${type}: ${count}\n`;
    });

    if (patterns.length > 0) {
      summary += `\n**Common Patterns:**\n`;
      patterns.slice(0, 5).forEach(pattern => {
        summary += `- ${pattern.pattern} (used ${pattern.frequency} times)\n`;
      });
    }

    summary += `\n**Recent Decisions:**\n`;
    recentDecisions.forEach((decision, index) => {
      summary += `${index + 1}. **${decision.type}**: ${decision.decision}\n`;
    });

    return summary;
  }
}