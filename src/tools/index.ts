import { TigerCloudDB, Decision } from '../database';
import { ArchitecturalIntelligence } from '../intelligence';
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

export class ToolHandler {
  private database: TigerCloudDB;
  private intelligence: ArchitecturalIntelligence;

  constructor(database: TigerCloudDB) {
    this.database = database;
    this.intelligence = new ArchitecturalIntelligence();
  }

  async handleRememberDecision(
    args: any,
    projectId: string,
    sessionId: string
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      const {
        decision,
        reasoning,
        type,
        alternatives_considered = [],
        files_affected = [],
        confidence,
        public: isPublic
      } = args;

      if (!decision || !reasoning || !type || confidence === undefined || isPublic === undefined) {
        throw new Error('Missing required fields: decision, reasoning, type, confidence, public');
      }

      if (confidence < 0 || confidence > 1) {
        throw new Error('Confidence must be between 0 and 1');
      }

      const validTypes = ['tech_stack', 'architecture', 'pattern', 'tool_choice'];
      if (!validTypes.includes(type)) {
        throw new Error(`Type must be one of: ${validTypes.join(', ')}`);
      }

      logger.info('Generating embedding for decision', { decision: decision.substring(0, 50) });
      const embedding = await this.intelligence.generateDecisionEmbedding(decision, reasoning, type);

      const decisionRecord: Decision = {
        project_id: projectId,
        session_id: sessionId,
        decision,
        reasoning,
        type,
        alternatives_considered,
        files_affected,
        confidence,
        public: isPublic,
        vector_embedding: embedding
      };

      const savedDecision = await this.database.saveDecision(decisionRecord);
      logger.info('Decision saved successfully', { id: savedDecision.id });

      await this.database.updateSessionDecisionCount(
        sessionId,
        await this.getSessionDecisionCount(sessionId)
      );

      return {
        content: [{
          type: 'text',
          text: `✅ Decision remembered successfully!\n\n**Decision**: ${decision}\n**Type**: ${type}\n**Confidence**: ${Math.round(confidence * 100)}%\n\nThis decision has been stored and will be available for future context recall.`
        }]
      };
    } catch (error) {
      logger.error('Error in handleRememberDecision', { error, args });
      return {
        content: [{
          type: 'text',
          text: `❌ Failed to remember decision: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      };
    }
  }

  async handleRecallContext(
    args: any,
    projectId: string
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      const { query, limit = 10 } = args;

      let decisions: Decision[];

      if (query) {
        logger.info('Performing semantic search', { query });
        const queryEmbedding = await this.intelligence.generateQueryEmbedding(query);
        decisions = await this.database.searchDecisionsByVector(queryEmbedding, projectId, limit);
      } else {
        decisions = await this.database.getProjectDecisions(projectId, limit);
      }

      if (decisions.length === 0) {
        return {
          content: [{
            type: 'text',
            text: query 
              ? `No decisions found matching query: "${query}"`
              : 'No previous decisions found for this project. This appears to be a fresh start!'
          }]
        };
      }

      const summary = this.intelligence.generateArchitecturalSummary(decisions);
      
      let contextText = summary + '\n\n**Detailed Decisions:**\n\n';
      
      decisions.forEach((decision, index) => {
        contextText += `### ${index + 1}. ${decision.type.toUpperCase()}: ${decision.decision}\n`;
        contextText += `**Reasoning**: ${decision.reasoning}\n`;
        
        if (decision.alternatives_considered && decision.alternatives_considered.length > 0) {
          contextText += `**Alternatives Considered**: ${decision.alternatives_considered.join(', ')}\n`;
        }
        
        if (decision.files_affected && decision.files_affected.length > 0) {
          contextText += `**Files Affected**: ${decision.files_affected.join(', ')}\n`;
        }
        
        contextText += `**Confidence**: ${Math.round(decision.confidence * 100)}%\n`;
        
        if (decision.created_at) {
          contextText += `**Date**: ${decision.created_at.toISOString().split('T')[0]}\n`;
        }
        
        contextText += '\n---\n\n';
      });

      logger.info('Context recalled successfully', { 
        projectId, 
        decisionCount: decisions.length,
        hasQuery: !!query 
      });

      return {
        content: [{
          type: 'text',
          text: contextText
        }]
      };
    } catch (error) {
      logger.error('Error in handleRecallContext', { error, args, projectId });
      return {
        content: [{
          type: 'text',
          text: `❌ Failed to recall context: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      };
    }
  }

  async handleDiscoverPatterns(
    args: any
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      const { query, tech_stack, project_type } = args;

      if (!query) {
        throw new Error('Query is required for pattern discovery');
      }

      logger.info('Discovering architectural patterns', { query, tech_stack, project_type });

      const patterns = await this.database.getArchitecturalPatterns(tech_stack, project_type, 10);
      
      if (patterns.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `No architectural patterns found matching your criteria.\n\n**Query**: ${query}\n**Tech Stack**: ${tech_stack?.join(', ') || 'Any'}\n**Project Type**: ${project_type || 'Any'}`
          }]
        };
      }

      const queryEmbedding = await this.intelligence.generateQueryEmbedding(query);
      
      const publicDecisions = await this.database.searchDecisionsByVector(queryEmbedding, undefined, 20);
      const extractedPatterns = this.intelligence.extractPatterns(publicDecisions);
      const rankedPatterns = this.intelligence.rankPatternsByRelevance(extractedPatterns, query);

      let patternsText = `# 🔍 Architectural Patterns Discovery\n\n`;
      patternsText += `**Search Query**: ${query}\n`;
      if (tech_stack) patternsText += `**Tech Stack Filter**: ${tech_stack.join(', ')}\n`;
      if (project_type) patternsText += `**Project Type Filter**: ${project_type}\n`;
      patternsText += '\n';

      if (rankedPatterns.length > 0) {
        patternsText += '## 📊 Community Patterns\n\n';
        rankedPatterns.slice(0, 5).forEach((pattern, index) => {
          patternsText += `### ${index + 1}. ${pattern.pattern.charAt(0).toUpperCase() + pattern.pattern.slice(1).replace(/-/g, ' ')}\n`;
          patternsText += `**Usage Frequency**: ${pattern.frequency} projects\n`;
          patternsText += `**Relevance Score**: ${Math.round(pattern.relevance * 100)}%\n`;
          patternsText += `**Examples**:\n`;
          pattern.examples.forEach(example => {
            patternsText += `- ${example}\n`;
          });
          patternsText += '\n';
        });
      }

      if (patterns.length > 0) {
        patternsText += '## 🏛️ Database Patterns\n\n';
        patterns.slice(0, 5).forEach((pattern, index) => {
          patternsText += `### ${index + 1}. ${pattern.pattern_name}\n`;
          patternsText += `**Description**: ${pattern.description}\n`;
          patternsText += `**Usage Count**: ${pattern.usage_count}\n`;
          patternsText += `**Success Rate**: ${Math.round(pattern.success_rate * 100)}%\n`;
          if (pattern.tech_stack.length > 0) {
            patternsText += `**Common Tech Stack**: ${pattern.tech_stack.join(', ')}\n`;
          }
          patternsText += '\n';
        });
      }

      patternsText += '\n💡 **Tip**: These patterns are derived from successful projects with similar requirements. Consider how they might apply to your specific context.\n';

      return {
        content: [{
          type: 'text',
          text: patternsText
        }]
      };
    } catch (error) {
      logger.error('Error in handleDiscoverPatterns', { error, args });
      return {
        content: [{
          type: 'text',
          text: `❌ Failed to discover patterns: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      };
    }
  }

  async handleGetTimeline(
    args: any,
    projectId: string
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      const { since, category } = args;

      let sinceDate: Date | undefined;
      if (since) {
        sinceDate = new Date(since);
        if (isNaN(sinceDate.getTime())) {
          throw new Error('Invalid date format for "since" parameter');
        }
      }

      logger.info('Retrieving decision timeline', { projectId, since, category });

      const decisions = await this.database.getDecisionTimeline(projectId, sinceDate, category);

      if (decisions.length === 0) {
        let message = 'No decisions found';
        if (category) message += ` for category "${category}"`;
        if (since) message += ` since ${since}`;
        message += '.';

        return {
          content: [{
            type: 'text',
            text: message
          }]
        };
      }

      let timelineText = '# 📅 Project Decision Timeline\n\n';
      
      if (category) timelineText += `**Category Filter**: ${category}\n`;
      if (since) timelineText += `**Since**: ${since}\n`;
      timelineText += `**Total Decisions**: ${decisions.length}\n\n`;

      const decisionsByDate = decisions.reduce((acc, decision) => {
        const date = decision.created_at ? decision.created_at.toISOString().split('T')[0]! : 'Unknown';
        if (!acc[date]) acc[date] = [];
        acc[date]!.push(decision);
        return acc;
      }, {} as Record<string, Decision[]>);

      Object.entries(decisionsByDate)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([date, dayDecisions]) => {
          timelineText += `## 📆 ${date}\n\n`;
          
          dayDecisions.forEach((decision, index) => {
            timelineText += `### ${index + 1}. [${decision.type.toUpperCase()}] ${decision.decision}\n`;
            timelineText += `${decision.reasoning}\n`;
            
            if (decision.confidence) {
              timelineText += `**Confidence**: ${Math.round(decision.confidence * 100)}%\n`;
            }
            
            if (decision.files_affected && decision.files_affected.length > 0) {
              timelineText += `**Files**: ${decision.files_affected.join(', ')}\n`;
            }
            
            timelineText += '\n';
          });
          
          timelineText += '---\n\n';
        });

      return {
        content: [{
          type: 'text',
          text: timelineText
        }]
      };
    } catch (error) {
      logger.error('Error in handleGetTimeline', { error, args, projectId });
      return {
        content: [{
          type: 'text',
          text: `❌ Failed to get timeline: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      };
    }
  }

  private async getSessionDecisionCount(sessionId: string): Promise<number> {
    const query = 'SELECT COUNT(*) as count FROM decisions WHERE session_id = $1';
    const result = await this.database['query']<{ count: string }>(query, [sessionId]);
    return parseInt(result.rows[0]?.count || '0', 10);
  }
}