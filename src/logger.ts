import winston from 'winston';

const logLevel = process.env['LOG_LEVEL'] || 'info';
const nodeEnv = process.env['NODE_ENV'] || 'development';

const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({
    format: 'HH:mm:ss'
  }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let logMessage = `${timestamp} [${level}]: ${message}`;
    
    if (Object.keys(meta).length > 0) {
      logMessage += ` ${JSON.stringify(meta)}`;
    }
    
    return logMessage;
  })
);

const transports: winston.transport[] = [
  new winston.transports.Console({
    level: logLevel,
    format: nodeEnv === 'production' ? logFormat : consoleFormat,
    handleExceptions: true,
    handleRejections: true
  })
];

if (nodeEnv === 'production') {
  transports.push(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: logFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      handleExceptions: true
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      format: logFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  );
}

export const logger = winston.createLogger({
  level: logLevel,
  format: logFormat,
  transports,
  exitOnError: false
});

export class TigerMemoryError extends Error {
  public code: string;
  public statusCode: number;
  public context?: Record<string, any>;

  constructor(
    message: string,
    code: string = 'UNKNOWN_ERROR',
    statusCode: number = 500,
    context?: Record<string, any>
  ) {
    super(message);
    this.name = 'TigerMemoryError';
    this.code = code;
    this.statusCode = statusCode;
    this.context = context || {};
    
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorCodes = {
  // Database errors
  DB_CONNECTION_FAILED: 'DB_CONNECTION_FAILED',
  DB_QUERY_FAILED: 'DB_QUERY_FAILED',
  DB_TRANSACTION_FAILED: 'DB_TRANSACTION_FAILED',
  
  // Project errors
  PROJECT_NOT_DETECTED: 'PROJECT_NOT_DETECTED',
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  PROJECT_ALREADY_EXISTS: 'PROJECT_ALREADY_EXISTS',
  
  // MCP errors
  MCP_TOOL_ERROR: 'MCP_TOOL_ERROR',
  MCP_INVALID_PARAMS: 'MCP_INVALID_PARAMS',
  MCP_SERVER_ERROR: 'MCP_SERVER_ERROR',
  
  // OpenAI errors
  OPENAI_API_ERROR: 'OPENAI_API_ERROR',
  EMBEDDING_GENERATION_FAILED: 'EMBEDDING_GENERATION_FAILED',
  
  // Auth errors
  AUTH_FAILED: 'AUTH_FAILED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  UNAUTHORIZED: 'UNAUTHORIZED',
  
  // Configuration errors
  MISSING_CONFIG: 'MISSING_CONFIG',
  INVALID_CONFIG: 'INVALID_CONFIG',
  
  // Validation errors
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD'
} as const;

export function logError(error: Error, context?: Record<string, any>): void {
  if (error instanceof TigerMemoryError) {
    logger.error(error.message, {
      code: error.code,
      statusCode: error.statusCode,
      context: error.context,
      stack: error.stack,
      ...context
    });
  } else {
    logger.error(error.message, {
      name: error.name,
      stack: error.stack,
      ...context
    });
  }
}

export function logInfo(message: string, meta?: Record<string, any>): void {
  logger.info(message, meta);
}

export function logDebug(message: string, meta?: Record<string, any>): void {
  logger.debug(message, meta);
}

export function logWarn(message: string, meta?: Record<string, any>): void {
  logger.warn(message, meta);
}

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception:', {
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown, promise: Promise<any>) => {
  logger.error('Unhandled Rejection at:', {
    promise,
    reason: reason instanceof Error ? reason.message : String(reason)
  });
  process.exit(1);
});