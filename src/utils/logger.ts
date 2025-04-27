import winston from 'winston';

let logger: winston.Logger;

export function setupLogger(): winston.Logger {
  logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
    defaultMeta: { service: 'web-testing-engine' },
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        )
      }),
      new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
      new winston.transports.File({ filename: 'logs/combined.log' })
    ]
  });

  return logger;
}

export function getLogger(context: string): winston.Logger {
  if (!logger) {
    setupLogger();
  }
  
  return logger.child({ context });
}