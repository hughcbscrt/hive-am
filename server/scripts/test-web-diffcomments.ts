// Comments on diff lines (web/lib/git/diffComments.ts): what a selection cites, the limits, how a comment follows its lines
// and the exact message the agent gets, in English and Spanish. No model, no browser. Usage: HIVE_AM_HOME=$(mktemp -d) npx tsx scripts/test-web-diffcomments.ts
import './_guard.js';
import { parseDiff, type DiffLine } from '../../web/lib/git/diff.ts';
import { MAX_CHARS, MAX_COMMENTS, buildMessage, canAdd, cite, clampText, makeComment, markGone, pruneComments, reanchor, sortForMessage, type DiffComment } from '../../web/lib/git/diffComments.ts';
import { setCurrentLocale, translate } from '../../web/lib/i18n/core.ts';
let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); if (!ok) fail++; };
const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const diff = (body: string) => parseDiff(`diff --git a/f b/f\n--- a/f\n+++ b/f\n${body}`);
const one = diff(['@@ -28,6 +28,7 @@ function go()', ' const a = 1;', '-if (!id) return;', '-log(id);', '+guard(id);', '+log(id, 2);', ' const b = 2;', ' return a + b;', ' }'].join('\n'));
const L = one.hunks[0].lines;   // ctx28/28, del29, del30, add29, add30, ctx31/31 ...
const pick = (from: number, to: number) => L.slice(from, to + 1);

// cite
eq('cite: add and ctx mixed with del cite the new numbers min to max', cite(pick(0, 4)), { newFrom: 28, newTo: 30, oldFrom: 28, oldTo: 30, removed: false });
eq('cite: only removed lines cite the old ones', cite(pick(1, 2)), { newFrom: undefined, newTo: undefined, oldFrom: 29, oldTo: 30, removed: true });
const single = makeComment('f', pick(3, 3), 'x', NOW, 'c');
eq('cite: one line has no dash', buildMessage([single], translate).split('\n')[2], '1. f:29: x');
const created = diff(['@@ -0,0 +1,3 @@', '+a', '+b', '+c'].join('\n'));
eq('cite: a new file cites new numbers', cite(created.hunks[0].lines), { newFrom: 1, newTo: 3, oldFrom: undefined, oldTo: undefined, removed: false });
const deleted = diff(['@@ -1,2 +0,0 @@', '-a', '-b'].join('\n'));
eq('cite: a deleted file cites old numbers, removed', cite(deleted.hunks[0].lines), { newFrom: undefined, newTo: undefined, oldFrom: 1, oldTo: 2, removed: true });

// limits
eq('clampText: 1000 characters', clampText('a'.repeat(1500)).length, MAX_CHARS);
eq('clampText: never half an emoji', clampText('a'.repeat(999) + '🐝🐝').length, 999);
const list = (n: number) => Array.from({ length: n }, (_, i) => makeComment(`p${i}`, pick(3, 3), 'x', NOW, `c${i}`));
eq('canAdd: 24 yes', canAdd(list(24)), true);
eq('canAdd: 25 no', canAdd(list(MAX_COMMENTS)), false);
const wide = diff(['@@ -1,3 +1,4 @@', ...Array.from({ length: 4 }, (_, i) => `+${String(i).repeat(200)}`)].join('\n'));
// The bound of the design (25 x (1000 + 3 x 125 + ~90)) holds for paths like web/lib/store.tsx; each character of path adds 25 to it.
const worst = Array.from({ length: MAX_COMMENTS }, (_, i) => ({ ...makeComment(`web/lib/store${i % 10}.tsx`, wide.hunks[0].lines, 'w'.repeat(1000), NOW, `w${i}`), removed: true, outdated: true }));
const big = buildMessage(worst, translate);
eq('worst case: 25 comments of 1000 characters with 3 quoted lines of 120 stay under 37 000', [big.length <= 37000, big.split('\n').filter((l) => l.startsWith('   > ') && !l.startsWith('   > … ')).every((l) => Array.from(l).length <= 7 + 120)], [true, true]);

// reanchor
const base = diff(['@@ -10,4 +10,5 @@', ' keep();', '-old();', '+fresh();', '+more();', ' end();'].join('\n'));
const c0 = makeComment('f', base.hunks[0].lines.slice(2, 4), 'why', NOW, 'r');
const moved = diff(['@@ -40,4 +40,5 @@', ' keep();', '-old();', '+fresh();', '+more();', ' end();'].join('\n'));
const r1 = reanchor(moved, 'f', [c0])[0];
eq('reanchor: the same lines moved take the new numbers', [r1.newFrom, r1.newTo, r1.outdated], [41, 42, false]);
const edited = diff(['@@ -10,4 +10,5 @@', ' keep();', '-old();', '+fresh(1);', '+more();', ' end();'].join('\n'));
eq('reanchor: changed text is outdated', reanchor(edited, 'f', [c0])[0].outdated, true);
eq('reanchor: outdated keeps its old numbers and text', [reanchor(edited, 'f', [c0])[0].newFrom, reanchor(edited, 'f', [c0])[0].text], [11, 'why']);
const twice = diff(['@@ -1,2 +1,3 @@', ' a();', '+fresh();', '+more();', '@@ -20,2 +21,3 @@', ' b();', '+fresh();', '+more();'].join('\n'));
const near = { ...c0, newFrom: 20, newTo: 21 };
eq('reanchor: repeated lines go to the closest place', reanchor(twice, 'f', [near])[0].newFrom, 22);
eq('reanchor: the other repetition when it was closer', reanchor(twice, 'f', [{ ...c0, newFrom: 3, newTo: 4 }])[0].newFrom, 2);
const split = diff(['@@ -1,1 +1,2 @@', ' x();', '+fresh();', '@@ -9,1 +10,2 @@', ' y();', '+more();'].join('\n'));
eq('reanchor: a run never crosses two hunks', reanchor(split, 'f', [c0])[0].outdated, true);
const spaces = diff(['@@ -10,4 +10,5 @@', ' keep();', '-old();', '+fresh() ;', '+more();', ' end();'].join('\n'));
eq('reanchor: reformatted spaces are outdated', reanchor(spaces, 'f', [c0])[0].outdated, true);
const other = makeComment('g', base.hunks[0].lines.slice(2, 4), 'other file', NOW, 'g');
eq('reanchor: other files are left alone', reanchor(edited, 'f', [c0, other])[1] === other, true);
const same = [c0];
eq('reanchor: nothing changed keeps the same array', reanchor(base, 'f', same) === same, true);
eq('reanchor: a comment found again is no longer outdated', reanchor(base, 'f', [{ ...c0, outdated: true, gone: false }])[0].outdated, false);

// markGone
const gone = markGone([c0, other], new Set(['g']), false);
eq('markGone: a file out of the changes is outdated and gone', [gone[0].outdated, gone[0].gone, gone[1] === other], [true, true, true]);
eq('markGone: a truncated list changes nothing', markGone([c0], new Set(), true)[0] === c0, true);
const back = markGone(gone, new Set(['f', 'g']), false)[0];
eq('markGone: back in the changes drops gone, stays outdated', [back.gone, back.outdated], [false, true]);

// prune
eq('prune: 30 days stays, older goes', pruneComments([{ ...c0, at: NOW - 30 * DAY }, { ...c0, id: 'old', at: NOW - 30 * DAY - 1 }], NOW).map((c) => c.id), ['r']);

// the message, English
setCurrentLocale('en');
const m1 = makeComment('web/lib/store.tsx', [{ kind: 'add', newNo: 62, text: '  const next = { ...state };   ' }], 'Why is this copied twice? Use the reducer instead.', NOW, 'm1');
eq('message: one comment', buildMessage([m1], translate), [
  '1 comment on your changes:', '', '1. web/lib/store.tsx:62: Why is this copied twice? Use the reducer instead.', '   Code:', '   > +   const next = { ...state };',
].join('\n'));
const shellLines: DiffLine[] = [
  { kind: 'add', newNo: 88, text: '<button type="button" className="nav activity" ...' }, { kind: 'add', newNo: 89, text: '<Bell size={18} />' },
  { kind: 'add', newNo: 90, text: "<span className=\"t\">{t('attn.nav')}</span>" }, { kind: 'add', newNo: 91, text: '</button>' },
];
const m2 = { ...makeComment('web/components/Shell.tsx', shellLines, '  Keep this button above the terminal.\nMore detail on a second line of the comment.  ', NOW, 'm2'), outdated: true };
const m3 = makeComment('web/lib/old.ts', [{ kind: 'del', oldNo: 30, text: 'if (!id) return;' }, { kind: 'del', oldNo: 31, text: 'log(id);' }], 'Do not delete this guard.', NOW, 'm3');
eq('message: the three of the design, sorted by path then line', buildMessage([m1, m2, m3], translate), [
  '3 comments on your changes:',
  'Line numbers refer to the files as they are now. "removed" marks lines that were deleted, numbered as in the previous version.',
  '"outdated" marks comments written before the file changed; the quoted code shows what was commented on.',
  '',
  '1. web/components/Shell.tsx:88-91 (outdated): Keep this button above the terminal.',
  '   More detail on a second line of the comment.',
  '   Code:',
  '   > + <button type="button" className="nav activity" ...',
  '   > + <Bell size={18} />',
  "   > + <span className=\"t\">{t('attn.nav')}</span>",
  '   > … 1 more line',
  '2. web/lib/old.ts:30-31 (removed): Do not delete this guard.',
  '   Code:',
  '   > - if (!id) return;',
  '   > - log(id);',
  '3. web/lib/store.tsx:62: Why is this copied twice? Use the reducer instead.',
  '   Code:',
  '   > +   const next = { ...state };',
].join('\n'));
eq('message: no final line break', buildMessage([m1], translate).endsWith('\n'), false);
const both = { ...m3, outdated: true };
eq('message: removed and outdated', buildMessage([both], translate).split('\n').slice(0, 5), [
  '1 comment on your changes:',
  'Line numbers refer to the files as they are now. "removed" marks lines that were deleted, numbered as in the previous version.',
  '"outdated" marks comments written before the file changed; the quoted code shows what was commented on.',
  '', '1. web/lib/old.ts:30-31 (removed, outdated): Do not delete this guard.',
]);
const blank = makeComment('a.ts', [{ kind: 'ctx', oldNo: 5, newNo: 5, text: 'same();' }], 'First line\n\n   \nAfter a blank line', NOW, 'b');
eq('message: a blank line inside the comment has no spaces, context has a space as sign', buildMessage([blank], translate).split('\n').slice(2), ['1. a.ts:5: First line', '', '', '   After a blank line', '   Code:', '   >   same();']);
const five = diff(['@@ -1,0 +1,5 @@', '+1', '+2', '+3', '+4', '+5'].join('\n'));
eq('message: two more lines', buildMessage([makeComment('n.ts', five.hunks[0].lines, 'x', NOW, 'n')], translate).split('\n').pop(), '   > … 2 more lines');
const long = makeComment('l.ts', [{ kind: 'add', newNo: 1, text: 'y'.repeat(121) }], 'x', NOW, 'l');
const longLine = buildMessage([long], translate).split('\n')[4];
eq('message: a code line of 121 characters is 119 and an ellipsis', [longLine, Array.from(longLine.slice('   > + '.length)).length], [`   > + ${'y'.repeat(119)}…`, 120]);
const exact = makeComment('l.ts', [{ kind: 'add', newNo: 1, text: 'z'.repeat(120) }], 'x', NOW, 'e');
eq('message: 120 characters stay whole', buildMessage([exact], translate).split('\n')[4], `   > + ${'z'.repeat(120)}`);
const empty = makeComment('e.ts', [{ kind: 'add', newNo: 3, text: '' }], 'x', NOW, 'z');
eq('message: an empty code line has no trailing space', buildMessage([empty], translate).split('\n')[4], '   > +');
eq('sort: by path then line', sortForMessage([{ ...m1, id: 'b', newFrom: 90 }, { ...m1, id: 'a', newFrom: 9 }, { ...m1, id: 'c', path: 'A.ts' }]).map((c) => c.id), ['c', 'a', 'b']);
eq('message: the comment text is not touched', buildMessage([makeComment('t.ts', [{ kind: 'add', newNo: 1, text: 'x' }], 'Añade «x» y <b> tal cual', NOW, 't')], translate).split('\n')[2], '1. t.ts:1: Añade «x» y <b> tal cual');

// the message, Spanish
setCurrentLocale('es');
eq('message es: removed and outdated, Code and one more line', buildMessage([m2, m3], translate), [
  '2 comentarios sobre tus cambios:',
  'Los números de línea son los de los archivos tal como están ahora. "eliminada" marca líneas borradas, numeradas como en la versión anterior.',
  '"desactualizado" marca comentarios escritos antes de que el archivo cambiara; el código citado muestra lo que se comentó.',
  '',
  '1. web/components/Shell.tsx:88-91 (desactualizado): Keep this button above the terminal.',
  '   More detail on a second line of the comment.',
  '   Código:',
  '   > + <button type="button" className="nav activity" ...',
  '   > + <Bell size={18} />',
  "   > + <span className=\"t\">{t('attn.nav')}</span>",
  '   > … 1 línea más',
  '2. web/lib/old.ts:30-31 (eliminada): Do not delete this guard.',
  '   Código:',
  '   > - if (!id) return;',
  '   > - log(id);',
].join('\n'));
eq('message es: one comment', buildMessage([m1], translate).split('\n')[0], '1 comentario sobre tus cambios:');
eq('message es: two more lines', buildMessage([makeComment('n.ts', five.hunks[0].lines, 'x', NOW, 'n')], translate).split('\n').pop(), '   > … 2 líneas más');
eq('message es: both marks', buildMessage([both], translate).split('\n')[4], '1. web/lib/old.ts:30-31 (eliminada, desactualizado): Do not delete this guard.');
setCurrentLocale('en');

const keep: DiffComment[] = [];
eq('empty list helpers', [canAdd(keep), pruneComments(keep, NOW) === keep], [true, true]);
console.log(fail ? `${fail} FAILED` : 'ALL PASSED'); process.exit(fail ? 1 : 0);
