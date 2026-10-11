import { randomBytes } from 'node:crypto';
import { ObjectError } from './model.js';

/**
 * Ready-made compose files for common services (a database, a cache, a broker…), the way Portainer's app templates work: pick one, fill a
 * few values, and the compose file is written and becomes a Docker object. The values are checked and written between quotes, so none
 * of them can add anything else to the file.
 */
export interface TemplateField { key: string; label: string; kind: 'text' | 'port' | 'secret'; default: string }
export interface AppTemplate { id: string; name: string; description: string; fields: TemplateField[]; compose: (v: Record<string, string>) => string }
export type TemplateInfo = Omit<AppTemplate, 'compose'>;

const q = (v: string) => JSON.stringify(v);
const version = (def: string): TemplateField => ({ key: 'version', label: 'Version (image tag)', kind: 'text', default: def });
const port = (key: string, label: string, def: string): TemplateField => ({ key, label, kind: 'port', default: def });
const text = (key: string, label: string, def: string): TemplateField => ({ key, label, kind: 'text', default: def });
const secret = (key: string, label: string): TemplateField => ({ key, label, kind: 'secret', default: '' });

export const TEMPLATES: AppTemplate[] = [
  { id: 'redis', name: 'Redis', description: 'In-memory cache and queue', fields: [version('7-alpine'), port('port', 'Port on this machine', '6379')],
    compose: (v) => `services:\n  redis:\n    image: redis:${v.version}\n    ports: [${q(`${v.port}:6379`)}]\n    volumes: [redis-data:/data]\n    restart: unless-stopped\nvolumes:\n  redis-data:\n` },
  { id: 'valkey', name: 'Valkey', description: 'Open-source Redis-compatible store', fields: [version('8-alpine'), port('port', 'Port on this machine', '6379')],
    compose: (v) => `services:\n  valkey:\n    image: valkey/valkey:${v.version}\n    ports: [${q(`${v.port}:6379`)}]\n    volumes: [valkey-data:/data]\n    restart: unless-stopped\nvolumes:\n  valkey-data:\n` },
  { id: 'postgres', name: 'PostgreSQL', description: 'Relational database', fields: [version('16-alpine'), port('port', 'Port on this machine', '5432'), text('user', 'User', 'app'), secret('password', 'Password'), text('database', 'Database', 'app')],
    compose: (v) => `services:\n  postgres:\n    image: postgres:${v.version}\n    environment:\n      POSTGRES_USER: ${q(v.user)}\n      POSTGRES_PASSWORD: ${q(v.password)}\n      POSTGRES_DB: ${q(v.database)}\n    ports: [${q(`${v.port}:5432`)}]\n    volumes: [pg-data:/var/lib/postgresql/data]\n    healthcheck:\n      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER"]\n      interval: 10s\n      retries: 5\n    restart: unless-stopped\nvolumes:\n  pg-data:\n` },
  { id: 'mariadb', name: 'MariaDB', description: 'MySQL-compatible database', fields: [version('11'), port('port', 'Port on this machine', '3306'), secret('password', 'Root password'), text('database', 'Database', 'app')],
    compose: (v) => `services:\n  mariadb:\n    image: mariadb:${v.version}\n    environment:\n      MARIADB_ROOT_PASSWORD: ${q(v.password)}\n      MARIADB_DATABASE: ${q(v.database)}\n    ports: [${q(`${v.port}:3306`)}]\n    volumes: [maria-data:/var/lib/mysql]\n    restart: unless-stopped\nvolumes:\n  maria-data:\n` },
  { id: 'mysql', name: 'MySQL', description: 'Relational database', fields: [version('8'), port('port', 'Port on this machine', '3306'), secret('password', 'Root password'), text('database', 'Database', 'app')],
    compose: (v) => `services:\n  mysql:\n    image: mysql:${v.version}\n    environment:\n      MYSQL_ROOT_PASSWORD: ${q(v.password)}\n      MYSQL_DATABASE: ${q(v.database)}\n    ports: [${q(`${v.port}:3306`)}]\n    volumes: [mysql-data:/var/lib/mysql]\n    restart: unless-stopped\nvolumes:\n  mysql-data:\n` },
  { id: 'mongodb', name: 'MongoDB', description: 'Document database', fields: [version('7'), port('port', 'Port on this machine', '27017'), text('user', 'User', 'app'), secret('password', 'Password')],
    compose: (v) => `services:\n  mongo:\n    image: mongo:${v.version}\n    environment:\n      MONGO_INITDB_ROOT_USERNAME: ${q(v.user)}\n      MONGO_INITDB_ROOT_PASSWORD: ${q(v.password)}\n    ports: [${q(`${v.port}:27017`)}]\n    volumes: [mongo-data:/data/db]\n    restart: unless-stopped\nvolumes:\n  mongo-data:\n` },
  { id: 'rabbitmq', name: 'RabbitMQ', description: 'Message broker with its web panel', fields: [version('3-management'), port('port', 'AMQP port', '5672'), port('webPort', 'Web panel port', '15672'), text('user', 'User', 'app'), secret('password', 'Password')],
    compose: (v) => `services:\n  rabbitmq:\n    image: rabbitmq:${v.version}\n    environment:\n      RABBITMQ_DEFAULT_USER: ${q(v.user)}\n      RABBITMQ_DEFAULT_PASS: ${q(v.password)}\n    ports: [${q(`${v.port}:5672`)}, ${q(`${v.webPort}:15672`)}]\n    volumes: [rabbit-data:/var/lib/rabbitmq]\n    restart: unless-stopped\nvolumes:\n  rabbit-data:\n` },
  { id: 'minio', name: 'MinIO', description: 'S3-compatible object storage', fields: [version('latest'), port('port', 'API port', '9000'), port('webPort', 'Console port', '9001'), text('user', 'User', 'minio'), secret('password', 'Password')],
    compose: (v) => `services:\n  minio:\n    image: minio/minio:${v.version}\n    command: server /data --console-address ":9001"\n    environment:\n      MINIO_ROOT_USER: ${q(v.user)}\n      MINIO_ROOT_PASSWORD: ${q(v.password)}\n    ports: [${q(`${v.port}:9000`)}, ${q(`${v.webPort}:9001`)}]\n    volumes: [minio-data:/data]\n    restart: unless-stopped\nvolumes:\n  minio-data:\n` },
  { id: 'nginx', name: 'Nginx', description: 'Web server', fields: [version('alpine'), port('port', 'Port on this machine', '8080')],
    compose: (v) => `services:\n  nginx:\n    image: nginx:${v.version}\n    ports: [${q(`${v.port}:80`)}]\n    restart: unless-stopped\n` },
  { id: 'mailpit', name: 'Mailpit', description: 'Catches the emails your app sends, with a web inbox', fields: [version('latest'), port('webPort', 'Inbox port', '8025'), port('port', 'SMTP port', '1025')],
    compose: (v) => `services:\n  mailpit:\n    image: axllent/mailpit:${v.version}\n    ports: [${q(`${v.webPort}:8025`)}, ${q(`${v.port}:1025`)}]\n    restart: unless-stopped\n` },
  { id: 'adminer', name: 'Adminer', description: 'Web panel for databases', fields: [version('latest'), port('port', 'Port on this machine', '8081')],
    compose: (v) => `services:\n  adminer:\n    image: adminer:${v.version}\n    ports: [${q(`${v.port}:8080`)}]\n    restart: unless-stopped\n` },
];

/** The catalog for the interface; each password starts with a random value. */
export const listTemplates = (): TemplateInfo[] => TEMPLATES.map(({ compose: _c, ...t }) => ({ ...t, fields: t.fields.map((f) => (f.kind === 'secret' ? { ...f, default: randomBytes(9).toString('base64url') } : f)) }));

/** Checks the values for a template (missing ones take the default) and returns the compose file. */
export function renderTemplate(id: string, given: Record<string, unknown>): string {
  const t = TEMPLATES.find((x) => x.id === id); if (!t) throw new ObjectError('Unknown template');
  const v: Record<string, string> = {};
  for (const f of t.fields) {
    const raw = String(given[f.key] ?? '').trim() || f.default;
    if (!raw) throw new ObjectError(`${f.label} is required`);
    if (f.kind === 'port') { const n = Number(raw); if (!Number.isInteger(n) || n < 1 || n > 65535) throw new ObjectError(`${f.label} must be a port between 1 and 65535`); v[f.key] = String(n); }
    else if (f.key === 'version') { if (!/^[\w][\w.-]{0,60}$/.test(raw)) throw new ObjectError('The version is not a valid image tag'); v[f.key] = raw; }
    else if (f.kind === 'secret') { if (!/^[\w.@%+=-]{1,64}$/.test(raw)) throw new ObjectError(`${f.label}: use letters, numbers and . @ % + = - _ (up to 64)`); v[f.key] = raw; }
    else { if (!/^[\w.@-]{1,64}$/.test(raw)) throw new ObjectError(`${f.label}: use letters, numbers and . @ - _ (up to 64)`); v[f.key] = raw; }
  }
  return t.compose(v);
}
