import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startSignalServer } from './server.ts';

// Shared repo-root .env (PORT, TRUST_PROXY). Existing environment variables win.
const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const port = Number(process.env.PORT ?? 8787);
const server = await startSignalServer({
  port,
  trustProxy: process.env.TRUST_PROXY === '1',
  // Events only: never room codes, SDP, candidates or IPs.
  log: (event, fields) => console.log(new Date().toISOString(), event, fields ? JSON.stringify(fields) : ''),
});
console.log(`Together signaling on ws://localhost:${server.port}  (health: http://localhost:${server.port}/health)`);

const shutdown = () => void server.close().then(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
