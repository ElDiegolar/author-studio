/** Everything the desktop shell runs in-process: the studio app and a tiny HTTP server for it. */
export { createApp } from '../../server/src/app.js';
export { serve } from '@hono/node-server';
