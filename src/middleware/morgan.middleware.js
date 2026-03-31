import morgan from 'morgan';
import { createStream } from 'rotating-file-stream';
import path from 'path';
import { fileURLToPath } from 'url';
import { ENV } from '#config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const accessStream = createStream('access.log', {
  interval: '1d',
  path: path.resolve(__dirname, '../../logs/access'),
  maxFiles: 14,
});

// Skip health check endpoints
const skipHealth = req => req.path === '/health' || req.path === '/api/health';

export const accessLogger = morgan(ENV.NODE_ENV === 'production' ? 'tiny' : 'dev', {
  stream: accessStream,
  skip: skipHealth,
});
