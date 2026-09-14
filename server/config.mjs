import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function integer(env, key, fallback, min, max) {
  if (env[key] == null || env[key] === '') return fallback;
  if (!/^\d+$/.test(env[key])) throw new Error(`${key} must be an integer.`);
  const n = Number(env[key]);
  if (n < min || n > max) throw new Error(`${key} is outside its supported range.`);
  return n;
}
export function configFrom(env = process.env, root = ROOT) {
  const port = integer(env, 'PORT', 4180, 1, 65535);
  const host = env.HOST || '127.0.0.1';
  const origin = new URL(env.PUBLIC_ORIGIN || `http://127.0.0.1:${port}`);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('PUBLIC_ORIGIN must be an HTTP(S) origin.');
  const token = env.ADMIN_TOKEN || '';
  if (token && token.length < 32) throw new Error('ADMIN_TOKEN must contain at least 32 characters.');
  return {
    root, port, host, origin: origin.origin,
    databasePath: path.resolve(root, env.DATABASE_PATH || './data/business-assistant.sqlite'),
    adminToken: token,
    bizinfoKey: env.BIZINFO_API_KEY || '',
    pageSize: integer(env, 'BIZINFO_PAGE_SIZE', 100, 1, 500),
    maxPages: integer(env, 'BIZINFO_MAX_PAGES', 100, 1, 200),
    timeoutMs: integer(env, 'REQUEST_TIMEOUT_MS', 20000, 1000, 120000),
    retries: integer(env, 'REQUEST_RETRIES', 2, 0, 4),
    schedulerEnabled: env.SYNC_ENABLED !== 'false',
    intervalMs: integer(env, 'SYNC_INTERVAL_HOURS', 24, 1, 168) * 3600000,
    retryMs: integer(env, 'SYNC_RETRY_MINUTES', 60, 5, 1440) * 60000,
    maxBytes: 20 * 1024 * 1024,
  };
}
export function loadConfig(root = ROOT) {
  const file = path.join(root, '.env');
  if (fs.existsSync(file)) process.loadEnvFile(file);
  return configFrom(process.env, root);
}
export function setupEnvironment(root = ROOT) {
  const file = path.join(root, '.env');
  if (fs.existsSync(file)) return false;
  const sample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  fs.writeFileSync(file, sample.replace(/^ADMIN_TOKEN=$/m, `ADMIN_TOKEN=${randomBytes(32).toString('hex')}`), { flag: 'wx', mode: 0o600 });
  return true;
}
