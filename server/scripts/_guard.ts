// Imported first by every test: these scripts create and delete objects, agents and so on, so they must never touch the real data.
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
const home = resolve(process.env.HIVE_AM_HOME ?? join(homedir(), '.hive-am'));
if (!process.env.HIVE_AM_HOME || home === resolve(join(homedir(), '.hive-am'))) {
  console.error('Refusing to run: set HIVE_AM_HOME to an empty temporary folder, e.g. HIVE_AM_HOME=$(mktemp -d) npx tsx scripts/<test>.ts');
  process.exit(2);
}
