import { readFileSync, statSync } from 'node:fs';
import { ObjectError } from './model.js';
import type { DbEngine } from './model.js';

/**
 * The properties of a database driver that can be changed from the object's settings. Each one is an option the Node driver
 * really takes (mysql2, pg, tedious through mssql, better-sqlite3), under the name the driver gives it, so every row has an effect
 * on the connection. What hive-am itself decides (host, port, credentials, read-only, the row limit, the query timeout, the
 * format of the results) is not here, so it cannot be overridden.
 */
export type PropType = 'string' | 'number' | 'boolean' | 'choice' | 'file';
export type PropGroup = 'session' | 'network' | 'ssl' | 'advanced';
export interface DriverProp {
  name: string; type: PropType; group: PropGroup; desc: string;
  /** The same description in Spanish. */
  es: string;
  choices?: string[]; min?: number; max?: number; placeholder?: string;
}


/** Spanish descriptions, by property name (the same name has the same meaning in every engine that has it). */
const ES: Record<string, string> = {
  'ssl.ca': 'Archivo con el certificado de la autoridad que firmó el del servidor (.pem). Hace falta para verificar una autoridad privada.',
  'ssl.cert': 'Certificado del cliente (.pem), para servidores que piden que el cliente se identifique.',
  'ssl.key': 'Llave privada del certificado del cliente (.pem, sin frase de contraseña).',
  'ssl.minVersion': 'Versión de TLS más antigua que acepta.',
  'ssl.ciphers': 'Suites de cifrado permitidas, en formato OpenSSL.',
  'ssl.servername': 'Nombre contra el que se comprueba el certificado del servidor, si no es el del host.',
  charset: 'Juego de caracteres o collation de la conexión.',
  timezone: 'Zona horaria con la que lee las fechas: local, Z o un desfase.',
  decimalNumbers: 'Devuelve las columnas DECIMAL como número y no como texto (puede perder precisión).',
  connectTimeout: 'Milisegundos que espera a que se abra la conexión (por defecto 10000).',
  enableKeepAlive: 'Mantiene viva la conexión con paquetes TCP keep-alive.',
  keepAliveInitialDelay: 'Milisegundos de silencio antes del primer paquete keep-alive.',
  compress: 'Comprime el tráfico con el servidor (ayuda en enlaces lentos).',
  insecureAuth: 'Permite servidores que aún usan el cifrado antiguo e inseguro de contraseñas.',
  enableCleartextPlugin: 'Permite el plugin de autenticación en texto claro (PAM y LDAP). Solo con SSL.',
  application_name: 'Nombre con el que aparece la sesión en pg_stat_activity.',
  search_path: 'Esquemas en los que busca, en orden (se envía como -c search_path=…).',
  client_encoding: 'Juego de caracteres de la conexión.',
  options: 'Otros ajustes de la sesión, como opciones de línea de comandos.',
  lock_timeout: 'Milisegundos que una sentencia espera un bloqueo antes de fallar (0 = sin límite).',
  idle_in_transaction_session_timeout: 'Milisegundos que una transacción abierta puede estar inactiva antes de que el servidor cierre la sesión (0 = sin límite).',
  connectionTimeoutMillis: 'Milisegundos que espera a que se abra la conexión (por defecto 10000).',
  keepAlive: 'Mantiene viva la conexión con paquetes TCP keep-alive.',
  keepAliveInitialDelayMillis: 'Milisegundos de silencio antes del primer paquete keep-alive.',
  enableChannelBinding: 'Exige channel binding de SCRAM (un intercambio de contraseña más fuerte, requiere SSL).',
  sslnegotiation: 'Cómo empieza TLS. "direct" se salta la petición en claro previa (PostgreSQL 17 o posterior).',
  appName: 'Nombre con el que aparece la sesión en sys.dm_exec_sessions.',
  language: 'Idioma de los mensajes del servidor.',
  dateFormat: 'Orden de día, mes y año al leer fechas.',
  datefirst: 'Primer día de la semana: 1 es lunes, 7 es domingo.',
  enableArithAbort: 'Detiene la sentencia ante un error aritmético (SET ARITHABORT).',
  useUTC: 'Lee y envía las fechas en UTC y no en hora local.',
  instanceName: 'Instancia con nombre (host\\NOMBRE). Con ella no se usa el puerto: se busca por el servicio SQL Browser.',
  connectionTimeout: 'Milisegundos que espera a que se abra la conexión (por defecto 10000).',
  packetSize: 'Bytes por paquete de red (de 512 a 32767).',
  readOnlyIntent: 'Pide la réplica de lectura de un grupo de disponibilidad.',
  multiSubnetFailover: 'Prueba a la vez todas las direcciones del listener de un grupo de disponibilidad.',
  workstationId: 'Nombre de equipo que la sesión informa al servidor.',
  serverName: 'Nombre que se envía al servidor al conectar por TLS (SNI), si no es el del host.',
  timeout: 'Milisegundos que espera cuando otro proceso tiene bloqueado el archivo (por defecto 5000).',
  foreign_keys: 'Hace cumplir las llaves foráneas.',
  case_sensitive_like: 'Hace que LIKE distinga mayúsculas de minúsculas.',
  cache_size: 'Páginas que mantiene en memoria; un número negativo son kilobytes.',
  temp_store: 'Dónde viven las tablas e índices temporales.',
};

const p = (name: string, type: PropType, group: PropGroup, desc: string, extra: Partial<DriverProp> = {}): DriverProp => ({ name, type, group, desc, es: ES[name] ?? desc, ...extra });

const TLS = ['TLSv1.2', 'TLSv1.3'];
/** TLS files and settings: the same names for the three server engines (SQL Server takes them inside `cryptoCredentialsDetails`). */
const sslProps = (servername: boolean): DriverProp[] => [
  p('ssl.ca', 'file', 'ssl', 'File with the certificate of the authority that signed the server certificate (.pem). Needed to verify a private authority.', { placeholder: '/etc/ssl/certs/my-ca.pem' }),
  p('ssl.cert', 'file', 'ssl', 'Client certificate (.pem), for servers that ask the client to identify itself.', { placeholder: '/home/you/client-cert.pem' }),
  p('ssl.key', 'file', 'ssl', 'Private key of the client certificate (.pem, not protected by a passphrase).', { placeholder: '/home/you/client-key.pem' }),
  p('ssl.minVersion', 'choice', 'ssl', 'Oldest TLS version it will accept.', { choices: TLS }),
  p('ssl.ciphers', 'string', 'ssl', 'Allowed cipher suites, in OpenSSL format.', { placeholder: 'ECDHE-RSA-AES256-GCM-SHA384' }),
  ...(servername ? [p('ssl.servername', 'string', 'ssl', 'Name the server certificate is checked against, when it differs from the host.', { placeholder: 'db.example.com' })] : []),
];

export const DRIVER_PROPS: Record<DbEngine, DriverProp[]> = {
  mysql: [
    p('charset', 'string', 'session', 'Character set or collation of the connection.', { placeholder: 'utf8mb4' }),
    p('timezone', 'string', 'session', 'Time zone used to read dates: local, Z or an offset.', { placeholder: 'Z' }),
    p('decimalNumbers', 'boolean', 'session', 'Return DECIMAL columns as numbers instead of text (can lose precision).'),
    p('connectTimeout', 'number', 'network', 'Milliseconds to wait for the connection to open (default 10000).', { min: 1000, max: 120000, placeholder: '10000' }),
    p('enableKeepAlive', 'boolean', 'network', 'Keep the connection alive with TCP keep-alive packets.'),
    p('keepAliveInitialDelay', 'number', 'network', 'Milliseconds of silence before the first keep-alive packet.', { min: 0, max: 600000, placeholder: '0' }),
    p('compress', 'boolean', 'network', 'Compress the traffic with the server (helps on slow links).'),
    p('insecureAuth', 'boolean', 'advanced', 'Allow servers that still use the old, insecure password hashing.'),
    p('enableCleartextPlugin', 'boolean', 'advanced', 'Allow the cleartext authentication plugin (PAM and LDAP setups). Only over SSL.'),
    ...sslProps(true),
  ],
  postgresql: [
    p('application_name', 'string', 'session', 'Name the session shows in pg_stat_activity.', { placeholder: 'hive-am' }),
    p('search_path', 'string', 'session', 'Schemas it looks in, in order (it is sent as -c search_path=…).', { placeholder: 'app,public' }),
    p('client_encoding', 'string', 'session', 'Character set of the connection.', { placeholder: 'UTF8' }),
    p('options', 'string', 'session', 'Other session settings, as command line options.', { placeholder: '-c timezone=UTC' }),
    p('lock_timeout', 'number', 'session', 'Milliseconds a statement waits for a lock before it fails (0 = no limit).', { min: 0, max: 3600000, placeholder: '0' }),
    p('idle_in_transaction_session_timeout', 'number', 'session', 'Milliseconds an open transaction may sit idle before the server ends the session (0 = no limit).', { min: 0, max: 3600000, placeholder: '0' }),
    p('connectionTimeoutMillis', 'number', 'network', 'Milliseconds to wait for the connection to open (default 10000).', { min: 1000, max: 120000, placeholder: '10000' }),
    p('keepAlive', 'boolean', 'network', 'Keep the connection alive with TCP keep-alive packets.'),
    p('keepAliveInitialDelayMillis', 'number', 'network', 'Milliseconds of silence before the first keep-alive packet.', { min: 0, max: 600000, placeholder: '0' }),
    p('enableChannelBinding', 'boolean', 'advanced', 'Require SCRAM channel binding (a stronger password exchange, needs SSL).'),
    p('sslnegotiation', 'choice', 'advanced', 'How TLS starts. "direct" skips the plain request first (PostgreSQL 17 and later).', { choices: ['postgres', 'direct'] }),
    ...sslProps(true),
  ],
  mssql: [
    p('appName', 'string', 'session', 'Name the session shows in sys.dm_exec_sessions.', { placeholder: 'hive-am' }),
    p('language', 'string', 'session', 'Language of the server messages.', { placeholder: 'us_english' }),
    p('dateFormat', 'choice', 'session', 'Order of day, month and year when reading dates.', { choices: ['mdy', 'dmy', 'ymd', 'ydm', 'myd', 'dym'] }),
    p('datefirst', 'number', 'session', 'First day of the week: 1 is Monday, 7 is Sunday.', { min: 1, max: 7, placeholder: '7' }),
    p('enableArithAbort', 'boolean', 'session', 'Stop a statement on an arithmetic error (SET ARITHABORT).'),
    p('useUTC', 'boolean', 'session', 'Read and send dates as UTC instead of local time.'),
    p('instanceName', 'string', 'network', 'Named instance (host\\NAME). With it the port is not used: the instance is found through the SQL Browser service.', { placeholder: 'SQLEXPRESS' }),
    p('connectionTimeout', 'number', 'network', 'Milliseconds to wait for the connection to open (default 10000).', { min: 1000, max: 120000, placeholder: '10000' }),
    p('packetSize', 'number', 'network', 'Bytes per network packet (512 to 32767).', { min: 512, max: 32767, placeholder: '4096' }),
    p('readOnlyIntent', 'boolean', 'network', 'Ask for the read replica of an availability group.'),
    p('multiSubnetFailover', 'boolean', 'network', 'Try every address of an availability group listener at once.'),
    p('workstationId', 'string', 'advanced', 'Host name the session reports to the server.', { placeholder: 'hive-am' }),
    p('serverName', 'string', 'advanced', 'Name sent to the server when it connects over TLS (SNI), when it differs from the host.', { placeholder: 'db.example.com' }),
    ...sslProps(false),
  ],
  sqlite: [
    p('timeout', 'number', 'session', 'Milliseconds to wait when the file is locked by another process (default 5000).', { min: 0, max: 600000, placeholder: '5000' }),
    p('foreign_keys', 'boolean', 'session', 'Enforce foreign keys.'),
    p('case_sensitive_like', 'boolean', 'session', 'Make LIKE case sensitive.'),
    p('cache_size', 'number', 'session', 'Pages kept in memory; a negative number is kilobytes.', { min: -1000000, max: 1000000, placeholder: '-2000' }),
    p('temp_store', 'choice', 'session', 'Where temporary tables and indexes live.', { choices: ['default', 'file', 'memory'] }),
  ],
};

export const MAX_PROPS = 40;
const CTRL = /[\0\r\n]/;

/** Checks the properties the interface sent: only known names, each with a value of its kind. Empty values are dropped. */
export function parseProps(engine: DbEngine, raw: unknown): Record<string, string> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new ObjectError('The driver properties must be a list of name and value');
  const known = new Map(DRIVER_PROPS[engine].map((x) => [x.name, x]));
  const out: Record<string, string> = {};
  for (const [name, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) continue;
    const def = known.get(name);
    if (!def) throw new ObjectError(`"${name}" is not a property this driver takes: choose it from the list`);
    const s = String(v).trim();
    if (s.length > 1000 || CTRL.test(s)) throw new ObjectError(`The value of "${name}" is not valid`);
    if (def.type === 'number') {
      const n = Number(s);
      if (!Number.isInteger(n) || (def.min !== undefined && n < def.min) || (def.max !== undefined && n > def.max)) throw new ObjectError(`"${name}" must be a whole number${def.min !== undefined ? ` from ${def.min} to ${def.max}` : ''}`);
    } else if (def.type === 'boolean') {
      if (s !== 'true' && s !== 'false') throw new ObjectError(`"${name}" must be true or false`);
    } else if (def.type === 'choice') {
      if (!def.choices!.includes(s)) throw new ObjectError(`"${name}" must be one of: ${def.choices!.join(', ')}`);
    } else if (def.type === 'file') {
      if (!s.startsWith('/')) throw new ObjectError(`"${name}" must be the absolute path of a file`);
    } else if (name === 'search_path' && !/^[A-Za-z0-9_$," .-]+$/.test(s)) throw new ObjectError('The search_path has characters that are not allowed');
    else if (name === 'options' && !/^[A-Za-z0-9_$=\-.,:/ ]+$/.test(s)) throw new ObjectError('"options" has characters that are not allowed');
    else if (name === 'instanceName' && !/^[A-Za-z0-9_$#@-]{1,128}$/.test(s)) throw new ObjectError('The instance name is not valid');
    out[name] = s;
  }
  if (Object.keys(out).length > MAX_PROPS) throw new ObjectError(`At most ${MAX_PROPS} driver properties`);
  return Object.keys(out).length ? out : undefined;
}

export type PropValue = string | number | boolean;
/** The properties as the driver wants them: numbers and booleans typed, files read (a missing file says which property it was). */
export function propValues(engine: DbEngine, props: Record<string, string> | undefined): Record<string, PropValue> {
  const out: Record<string, PropValue> = {};
  for (const def of DRIVER_PROPS[engine]) {
    const v = props?.[def.name];
    if (v === undefined) continue;
    if (def.type === 'number') out[def.name] = Number(v);
    else if (def.type === 'boolean') out[def.name] = v === 'true';
    else if (def.type === 'file') {
      try {
        if (!statSync(v).isFile()) throw new Error('not a file');
        out[def.name] = readFileSync(v, 'utf8');
      } catch { throw new ObjectError(`"${def.name}": the file ${v} cannot be read`); }
    } else out[def.name] = v;
  }
  return out;
}

/** The `ssl.*` properties as the options of a TLS socket (Node's `tls.connect`). */
export function tlsOptions(v: Record<string, PropValue>, verify: boolean): Record<string, unknown> {
  const o: Record<string, unknown> = { rejectUnauthorized: verify };
  const pick: [string, string][] = [['ssl.ca', 'ca'], ['ssl.cert', 'cert'], ['ssl.key', 'key'], ['ssl.minVersion', 'minVersion'], ['ssl.ciphers', 'ciphers'], ['ssl.servername', 'servername']];
  for (const [from, to] of pick) if (v[from] !== undefined) o[to] = v[from];
  return o;
}

/** The properties that are not `ssl.*`, ready to spread in the options of a driver. */
export const plain = (v: Record<string, PropValue>): Record<string, PropValue> => Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('ssl.')));
