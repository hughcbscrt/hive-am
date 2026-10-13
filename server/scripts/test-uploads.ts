// Files sent from the chat of the app: pictures are recognised by their bytes, anything else is kept under a safe name. No model. Usage: HIVE_AM_HOME=$(mktemp -d) npx tsx scripts/test-uploads.ts
import './_guard.js';
import { existsSync, readFileSync } from 'node:fs';
import { saveUploads, UPLOAD_MAX_FILES } from '../src/connections/files.js';
import { uploadsBlock } from '../src/connections/prompt.js';

let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); if (!ok) fail++; };
const throws = (name: string, f: () => unknown, re: RegExp) => { try { f(); eq(name, 'no error', re.source); } catch (e) { eq(name, re.test(String(e)), true); } };
const b64 = (b: Buffer | string) => `data:application/octet-stream;base64,${Buffer.from(b).toString('base64')}`;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);

const [pic, doc] = saveUploads('agent-a', [{ name: 'shot.jpeg', data: b64(PNG) }, { name: '../../etc/Informe final.pdf', data: b64('%PDF-1.4 hola'), type: 'application/pdf' }]);
eq('a picture is named after what it really is', [pic.name, pic.kind, pic.mime], ['shot.png', 'image', 'image/png']);
eq('another file keeps its name, without folders', [doc.name, doc.kind, doc.mime], ['Informe final.pdf', 'document', 'application/pdf']);
eq('it is saved inside the agent inbox', doc.path.includes('/inbox/agent-a/') && existsSync(doc.path) && readFileSync(doc.path, 'utf8') === '%PDF-1.4 hola', true);
eq('a script is just data: saved, not run, with no odd mime', saveUploads('agent-a', [{ name: 'run.sh', data: b64('#!/bin/sh\necho hi'), type: 'x y' }])[0].mime, undefined);
eq('the note lists every file', uploadsBlock([pic, doc]).split('\n').filter((l) => l.startsWith('- ')).length, 2);
throws('too many files', () => saveUploads('agent-a', Array.from({ length: UPLOAD_MAX_FILES + 1 }, () => ({ name: 'a.txt', data: b64('x') }))), /At most/);
throws('an empty file', () => saveUploads('agent-a', [{ name: 'a.txt', data: b64('') }]), /empty/);
console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
process.exit(fail ? 1 : 0);
