// The response handlers of .http files, without a model: what they can do (keep values, check the answer, read JSON and headers), what they
// refuse to do (anything that is not a plain handler: require, process, loops, prototypes), and that they cannot run away. Usage:
//   npx tsx scripts/test-http-script.ts
import './_guard.js';
import { runScript, type ScriptResponse } from '../src/objects/http-script.js';

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const res = (body: unknown, o: Partial<ScriptResponse> = {}): ScriptResponse => ({ status: 200, headers: { 'content-type': 'application/json', 'x-token': 'hdr-123', ...(o.headers ?? {}) }, body, text: typeof body === 'string' ? body : JSON.stringify(body), contentType: 'application/json; charset=utf-8', ...o, });
const body = { token: 'abc.def', user: { id: 7, name: 'Ana', roles: ['admin', 'dev'] }, items: [{ id: 1, ok: true }, { id: 2, ok: false }], count: 2 };
const go = (script: string, r = res(body), g: Record<string, string> = {}) => { const out = runScript(script, r, g); return { ...out, g }; };

// ---------------------------------------------------------------- keeping values
let r = go('client.global.set("token", response.body.token);');
check(r.g.token === 'abc.def' && r.set.join() === 'token' && !r.error, 'client.global.set keeps a value of the answer');
r = go('const t = response.body.token; client.global.set("auth", "Bearer " + t); client.global.set("id", response.body.user.id);');
check(r.g.auth === 'Bearer abc.def' && r.g.id === '7', 'local variables, concatenation, numbers become text');
r = go('client.global.set("h", response.headers.valueOf("X-Token")); client.global.set("ct", response.contentType.mimeType);');
check(r.g.h === 'hdr-123' && r.g.ct === 'application/json', 'a header (any case) and the content type');
r = go('client.global.set("first", response.body.items[0].id); client.global.set("role", response.body.user.roles[1]); client.global.set("n", response.body.items.length);');
check(r.g.first === '1' && r.g.role === 'dev' && r.g.n === '2', 'indexes and .length');
r = go('client.global.set("msg", `user ${response.body.user.name} has ${response.body.count} items`);');
check(r.g.msg === 'user Ana has 2 items', 'template strings');
r = go('client.global.set("a", 1);\nclient.global.set("b", 2);\nclient.global.clear("a");', res(body), { old: 'x' });
check(r.g.a === undefined && r.g.b === '2' && r.g.old === 'x' && r.cleared.join() === 'a', 'clear removes one value and leaves the others');
r = go('client.global.clearAll(); client.global.set("only", "1");', res(body), { x: '1', y: '2' });
check(Object.keys(r.g).join() === 'only', 'clearAll empties them');
r = go('if (response.status === 200) { client.global.set("ok", "yes"); } else { client.global.set("ok", "no"); }');
check(r.g.ok === 'yes', 'if / else');
r = go('client.global.set("who", response.body.user.name ? response.body.user.name : "nobody"); client.global.set("miss", response.body.nope || "default");');
check(r.g.who === 'Ana' && r.g.miss === 'default', '?: and ||');
r = go('const ids = response.body.items.map(i => i.id); client.global.set("ids", ids.join(",")); client.global.set("okid", response.body.items.find(function (i) { return i.ok; }).id);');
check(r.g.ids === '1,2' && r.g.okid === '1', 'arrow functions and function expressions in map / find');
r = go('client.global.set("n", response.body);', res('plain text', { contentType: 'text/plain' }));
check(r.g.n === 'plain text', 'a plain-text answer is the text');
r = go('const o = JSON.parse(response.body); client.global.set("v", o.a);', res('{"a": "from-text"}', { contentType: 'text/plain' }));
check(r.g.v === 'from-text', 'JSON.parse of a text answer');

// ---------------------------------------------------------------- checking the answer
r = go('client.test("status is 200", function () { client.assert(response.status === 200, "bad status"); });\nclient.test("has token", () => { client.assert(response.body.token.length > 3); });\nclient.test("count", function () { client.assert(response.body.count === 3, "expected 3 items"); });');
check(r.tests.length === 3 && r.tests[0].passed && r.tests[1].passed && !r.tests[2].passed && r.tests[2].message === 'expected 3 items' && !r.error, 'tests pass and fail by name, with their message');
r = go('client.test("reads a missing thing", function () { client.assert(response.body.nope.deep === 1); });');
check(r.tests.length === 1 && !r.tests[0].passed && /Cannot read/.test(r.tests[0].message ?? ''), 'a test that throws fails with the reason');
r = go('client.assert(response.status === 404, "must be 404"); client.global.set("after", "x");');
check(r.error === 'Assertion failed: must be 404' && r.g.after === undefined, 'an assertion outside a test stops the handler');
r = go('client.log("hello", response.body.count); client.global.set("a", "1");');
check(r.logs.join('|') === 'hello 2' && r.g.a === '1', 'client.log is collected');

// ---------------------------------------------------------------- what it refuses
const refused = (script: string, re: RegExp, what: string) => { const o = go(script); check(!!o.error && re.test(o.error) && o.set.length === 0 && Object.keys(o.g).length === 0, what); };
refused('const fs = require("fs");', /not defined|require/, 'require is not there');
refused('process.exit(1);', /not defined/, 'process is not there');
refused('client.global.set("x", globalThis);', /not defined/, 'globalThis is not there');
refused('client.global.set("x", response.constructor);', /not available/, '.constructor is refused');
refused('client.global.set("x", response.body.constructor.constructor("return process")());', /not available/, 'the classic escape through constructor is refused');
refused('client.global.set("x", response.__proto__);', /not available/, '__proto__ is refused');
refused('client.global.set("x", response["constr" + "uctor"]);', /not available/, 'and so is a property name built at run time');
refused('for (let i = 0; i < 3; i++) { client.global.set("a", i); }', /"for" is not supported/, 'loops are not supported');
refused('while (true) {}', /"while" is not supported/, 'while is not supported');
refused('new Function("return 1")();', /"new" is not supported/, 'new is not supported');
refused('client.global.set("x", eval("1"));', /not defined/, 'eval is not there');
refused('import("fs");', /not defined|Unexpected|not supported/, 'import is not supported');
refused('await fetch("http://x");', /"await" is not supported/, 'await is not supported');
refused('client.global.set("bad name", "x");', /not a valid variable name/, 'a variable with a bad name is refused');
check(go('client.global.set("a", "1"); response.body.nope.nope;').g.a === '1', 'what was set before an error is kept');
const syntax = go('client.global.set("a", ;');
check(!!syntax.error && /does not support|Unexpected/.test(syntax.error) && syntax.set.length === 0, 'a script that does not parse runs nothing and says why');

// ---------------------------------------------------------------- limits
const fnLoop = go('const f = () => f(); f();');
check(!!fnLoop.error && /more work than it is allowed/.test(fnLoop.error), 'a function that calls itself is stopped');
const big = go(`const f = (n) => n === 0 ? 0 : f(n - 1) + 1; client.global.set("r", f(50));`);
check(big.g.r === '50' && !big.error, 'ordinary recursion of a handler\'s size still works');
const t0 = Date.now(); go('const f = () => f(); f();'); check(Date.now() - t0 < 1500, 'and a runaway is stopped quickly');
r = go('client.global.set("n", response.body.items.filter(i => i.ok).length);');
check(r.g.n === '1', 'filter');

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
