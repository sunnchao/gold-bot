import pino from 'pino';

let logger: pino.Logger | null = null;

export function getLogger(): pino.Logger {
  if (logger) {
    return logger;
  }

  const level = process.env.LOG_LEVEL ?? 'info';
  const isProd = process.env.NODE_ENV === 'production';

  if (isProd) {
    logger = pino({ level });
  } else {
    logger = pino({
      level,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      },
    });
  }

  return logger;
}

export function resetLogger(): void {
  logger = null;
}
