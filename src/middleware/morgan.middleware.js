import morgan from 'morgan';
import { createStream } from 'rotating-file-stream';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const accessStream = createStream('access.log', {
  interval: '1d',
  path: path.resolve(__dirname, '../../logs/access'),
  maxFiles: 14,
});

// use 'tiny" instead of "dev" — no colors, clean for file
export const accessLogger = morgan('tiny', { stream: accessStream });
