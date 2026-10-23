// The volume rows of the Docker form (web/lib/dockerVolumes.ts): a saved config shows as rows and edits write back the same text it always
// saved, one `source:target[:options]` per line; and what the form makes of Docker's lists (web/lib/dockerLists.ts). No model, no browser.
// Usage: HIVE_AM_HOME=$(mktemp -d) npx tsx scripts/test-web-docker.ts
import './_guard.js';
import { emptyRow, isFolder, isIncomplete, isNewVolume, isReadOnly, parseVolumeLine, parseVolumes, volumesText, withReadOnly } from '../../web/lib/dockerVolumes.ts';
import { canCreate, canRemove, imageNameFor, validName, whenAvailable } from '../../web/lib/dockerLists.ts';
let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); if (!ok) fail++; };

eq('a volume name and a path', parseVolumeLine('data:/var/lib/data'), { source: 'data', target: '/var/lib/data', opts: [] });
eq('a folder, read only', parseVolumeLine('/home/you/site:/usr/share/nginx/html:ro'), { source: '/home/you/site', target: '/usr/share/nginx/html', opts: ['ro'] });
eq('several options keep their order', parseVolumeLine('data:/d:z,ro').opts, ['z', 'ro']);
eq('read only is read from the options', [isReadOnly(parseVolumeLine('a:/b:ro')), isReadOnly(parseVolumeLine('a:/b:rw')), isReadOnly(parseVolumeLine('a:/b'))], [true, false, false]);
eq('a line with no target, or with four parts, is kept as typed', [parseVolumeLine('/data').raw, parseVolumeLine('a:b:c:d').raw], ['/data', 'a:b:c:d']);
eq('folders and volume names are told apart', ['/srv', './x', '~/y', 'data', 'my_vol'].map(isFolder), [true, true, true, false, false]);

const saved = ['data:/var/lib/data', '/home/you/site:/srv:ro', 'cache:/c:z,ro', 'odd:a:b:c'].join('\n');
eq('a config saved before shows as rows and comes back the same', volumesText(parseVolumes(saved)), saved);
eq('nothing saved is no rows', parseVolumes(''), []);
const added = volumesText([...parseVolumes(''), emptyRow()]);
eq('adding the first row keeps one empty row', parseVolumes(added).length, 1);
eq('adding to rows keeps them and one empty row more', parseVolumes(volumesText([...parseVolumes(saved), emptyRow()])).length, 5);
eq('an empty row is a blank line, which saving skips (the form trims each line and drops blanks)', volumesText([emptyRow()]).trim(), '');
eq('removing the last row leaves nothing', volumesText(parseVolumes('data:/d').filter(() => false)), '');
eq('a row with only a source keeps the colon, so it is not taken for a path', volumesText([{ ...emptyRow(), source: 'data' }]), 'data:');

const r = parseVolumeLine('cache:/c:z');
eq('turning read only on adds ro after the other options', withReadOnly(r, true).opts, ['z', 'ro']);
eq('and off removes only ro', withReadOnly(parseVolumeLine('cache:/c:ro,z'), false).opts, ['z']);
eq('turning it on drops rw (they cannot go together)', withReadOnly(parseVolumeLine('a:/b:rw'), true).opts, ['ro']);
eq('turning it on twice does not repeat it', withReadOnly(withReadOnly(r, true), true).opts, ['z', 'ro']);

const vols = [{ name: 'data' }];
eq('a volume name the machine does not have is new; one it has, a folder or an empty source is not', ['cache', 'data', '/srv', ''].map((x) => isNewVolume(x, vols)), [true, false, false, false]);
const down = whenAvailable({ available: false }, [] as { name: string }[]);
eq('with Docker down the list is unknown (null), not empty', down, null);
eq('so no row says its volume is missing (the one notice is Docker\'s)', isNewVolume('cache', down), false);
eq('with Docker up the list is kept as it came', whenAvailable({ available: true }, vols), vols);
eq('a row with only one side is incomplete; a full one, an empty one or one kept as typed is not',
  [parseVolumeLine('data:'), parseVolumeLine(':/d'), parseVolumeLine('data:/d'), emptyRow(), parseVolumeLine('/data')].map(isIncomplete), [true, true, false, false, false]);

const nets = [{ name: 'bridge' }, { name: 'appnet' }];
eq('create is offered for a valid name Docker does not have', [canCreate('network', 'newnet', nets), canCreate('network', ' newnet ', nets)], [true, true]);
eq('not for one it has, an invalid name or one like an option, nor while Docker is not answering',
  [canCreate('network', 'appnet', nets), canCreate('network', 'my net', nets), canCreate('network', '-x', nets), canCreate('network', '', nets), canCreate('network', 'newnet', null)], [false, false, false, false, false]);
eq('a volume needs two characters and is never a 64-hex name (that is an anonymous one)', [validName('volume', 'a'), validName('volume', 'ab'), validName('volume', 'f'.repeat(64)), validName('network', 'a')], [false, true, false, true]);
eq('delete is offered only on what hive-am created and nothing uses',
  [canRemove({ managed: true, inUse: 0 }), canRemove({ managed: true, inUse: 1 }), canRemove({ managed: false, inUse: 0 }), canRemove({ managed: true, inUse: 0, builtin: true }), canRemove({ managed: true, inUse: 0, anonymous: true })], [true, false, false, false, false]);
eq('an image name is suggested from the Dockerfile\'s folder', [imageNameFor('/home/you/My App/Dockerfile'), imageNameFor('/srv/api/web.Dockerfile'), imageNameFor('/Dockerfile'), imageNameFor('')], ['my-app:latest', 'api:latest', '', '']);

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
