/**
 * The response handlers of a .http file (`> {% … %}`, the IntelliJ / VS Code REST client format), run safely. They are little scripts
 * that read the answer and keep values for the next requests (`client.global.set("token", response.body.token)`) or check it
 * (`client.test("ok", function () { client.assert(response.status === 200); })`).
 *
 * Nothing here runs JavaScript: the script is read by a small parser and evaluated by a small interpreter that only knows what such
 * handlers need — values, `response`, `client.global`, `client.test` / `client.assert` / `client.log`, `JSON`, local `var`/`let`/`const`,
 * `if`, functions and arrows, comparisons, `&&`, `||`, `? :`, `+`, and a short list of string and array methods. No `require`, no
 * `process`, no loops, no access to prototypes. Something outside of that is reported ("not supported") instead of being run, and a script
 * is limited in how much it may compute.
 */
export class ScriptError extends Error {}

export interface ScriptResponse { status: number; headers: Record<string, string>; body: unknown; text: string; contentType: string; /** How long the answer took, in ms (`response.time`). */ time?: number }
export interface ScriptTest { name: string; passed: boolean; message?: string }
export interface ScriptResult { tests: ScriptTest[]; logs: string[]; set: string[]; cleared: string[]; error?: string }

// ------------------------------------------------------------------ tokens
type Tok = { t: 'num' | 'str' | 'tpl' | 'id' | 'op' | 'eof'; v: string; parts?: (string | Tok[])[]; at: number };
const OPS3 = ['===', '!=='], OPS2 = ['==', '!=', '<=', '>=', '&&', '||', '??', '=>'];

function tokenize(src: string): Tok[] {
  const out: Tok[] = []; let i = 0;
  const fail = (m: string): never => { throw new ScriptError(m); };
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) fail('A comment is not closed'); i = e + 2; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) { const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i))!; out.push({ t: 'num', v: m[0], at: i }); i += m[0].length; continue; }
    if (/[A-Za-z_$]/.test(c)) { const m = /^[A-Za-z0-9_$]+/.exec(src.slice(i))!; out.push({ t: 'id', v: m[0], at: i }); i += m[0].length; continue; }
    if (c === '"' || c === "'") {
      let s = ''; const at = i; i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') { const n = src[++i]; s += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'r' ? '\r' : n; i++; } else s += src[i++];
      }
      if (i >= src.length) fail('A string is not closed');
      i++; out.push({ t: 'str', v: s, at }); continue;
    }
    if (c === '`') {
      const at = i; i++; const parts: (string | Tok[])[] = []; let s = '';
      while (i < src.length && src[i] !== '`') {
        if (src[i] === '\\') { const n = src[++i]; s += n === 'n' ? '\n' : n; i++; }
        else if (src[i] === '$' && src[i + 1] === '{') {
          let depth = 1, j = i + 2; while (j < src.length && depth) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
          if (depth) fail('A template is not closed');
          parts.push(s); s = ''; parts.push(tokenize(src.slice(i + 2, j - 1))); i = j;
        } else s += src[i++];
      }
      if (i >= src.length) fail('A template is not closed');
      i++; parts.push(s); out.push({ t: 'tpl', v: '', parts, at }); continue;
    }
    const three = src.slice(i, i + 3), two = src.slice(i, i + 2);
    if (OPS3.includes(three)) { out.push({ t: 'op', v: three, at: i }); i += 3; continue; }
    if (OPS2.includes(two)) { out.push({ t: 'op', v: two, at: i }); i += 2; continue; }
    if ('(){}[],;.:?!+-*/%<>='.includes(c)) { out.push({ t: 'op', v: c, at: i }); i++; continue; }
    fail(`Unexpected character "${c}"`);
  }
  out.push({ t: 'eof', v: '', at: src.length });
  return out;
}

// ------------------------------------------------------------------ syntax tree
type Node =
  | { k: 'lit'; v: unknown } | { k: 'id'; n: string } | { k: 'tpl'; parts: (string | Node)[] }
  | { k: 'mem'; o: Node; p: Node; opt?: boolean } | { k: 'call'; f: Node; a: Node[] }
  | { k: 'un'; op: string; e: Node } | { k: 'bin'; op: string; l: Node; r: Node } | { k: 'cond'; c: Node; a: Node; b: Node }
  | { k: 'asg'; n: string; e: Node } | { k: 'fn'; params: string[]; body: Stmt[] | Node }
  | { k: 'arr'; items: Node[] } | { k: 'obj'; props: [string, Node][] };
type Stmt =
  | { s: 'decl'; n: string; e: Node | null } | { s: 'expr'; e: Node } | { s: 'if'; c: Node; a: Stmt[]; b: Stmt[] }
  | { s: 'ret'; e: Node | null };

const KEYWORDS_NOT_SUPPORTED = new Set(['for', 'while', 'do', 'switch', 'try', 'catch', 'throw', 'class', 'new', 'import', 'export', 'async', 'await', 'yield', 'with', 'delete', 'void', 'in', 'of', 'instanceof', 'debugger']);

class Parser {
  i = 0;
  constructor(private toks: Tok[]) {}
  private get cur() { return this.toks[this.i]; }
  private is(v: string) { return this.cur.t === 'op' && this.cur.v === v; }
  private idIs(v: string) { return this.cur.t === 'id' && this.cur.v === v; }
  private eat(v: string) { if (!this.is(v)) throw new ScriptError(`Expected "${v}" but found "${this.cur.v || 'the end'}"`); this.i++; }
  private maybe(v: string) { if (this.is(v)) { this.i++; return true; } return false; }

  program(): Stmt[] { const out: Stmt[] = []; while (this.cur.t !== 'eof') out.push(this.stmt()); return out; }
  private block(): Stmt[] {
    if (this.maybe('{')) { const out: Stmt[] = []; while (!this.is('}')) { if (this.cur.t === 'eof') throw new ScriptError('A block is not closed'); out.push(this.stmt()); } this.eat('}'); return out; }
    return [this.stmt()];
  }
  private stmt(): Stmt {
    if (this.maybe(';')) return { s: 'expr', e: { k: 'lit', v: undefined } };
    const c = this.cur;
    if (c.t === 'id' && KEYWORDS_NOT_SUPPORTED.has(c.v)) throw new ScriptError(`"${c.v}" is not supported in hive-am response handlers`);
    if (c.t === 'id' && (c.v === 'var' || c.v === 'let' || c.v === 'const')) {
      this.i++; if (this.cur.t !== 'id') throw new ScriptError('Only a plain name can be declared');
      const n = this.cur.v; this.i++; let e: Node | null = null; if (this.maybe('=')) e = this.expr(); this.maybe(';'); return { s: 'decl', n, e };
    }
    if (c.t === 'id' && c.v === 'if') {
      this.i++; this.eat('('); const cond = this.expr(); this.eat(')'); const a = this.block(); let b: Stmt[] = [];
      if (this.idIs('else')) { this.i++; b = this.idIs('if') ? [this.stmt()] : this.block(); }
      return { s: 'if', c: cond, a, b };
    }
    if (c.t === 'id' && c.v === 'return') { this.i++; let e: Node | null = null; if (!this.is(';') && !this.is('}') && this.cur.t !== 'eof') e = this.expr(); this.maybe(';'); return { s: 'ret', e }; }
    const e = this.expr(); this.maybe(';'); return { s: 'expr', e };
  }
  expr(): Node {
    // an arrow function: `x => …` or `(a, b) => …`
    if (this.cur.t === 'id' && this.toks[this.i + 1]?.t === 'op' && this.toks[this.i + 1].v === '=>') { const p = this.cur.v; this.i += 2; return this.arrowBody([p]); }
    if (this.is('(')) {
      let j = this.i + 1; const params: string[] = [];
      while (this.toks[j]?.t === 'id') { params.push(this.toks[j].v); j++; if (this.toks[j]?.v === ',') j++; else break; }
      if (this.toks[j]?.v === ')' && this.toks[j + 1]?.v === '=>') { this.i = j + 2; return this.arrowBody(params); }
    }
    if (this.cur.t === 'id' && this.toks[this.i + 1]?.v === '=' && this.toks[this.i + 1].t === 'op') { const n = this.cur.v; this.i += 2; return { k: 'asg', n, e: this.expr() }; }
    return this.ternary();
  }
  private arrowBody(params: string[]): Node { if (this.is('{')) return { k: 'fn', params, body: this.block() }; return { k: 'fn', params, body: this.expr() }; }
  private ternary(): Node { const c = this.or(); if (this.maybe('?')) { const a = this.expr(); this.eat(':'); const b = this.expr(); return { k: 'cond', c, a, b }; } return c; }
  private or(): Node { let l = this.and(); while (this.is('||') || this.is('??')) { const op = this.cur.v; this.i++; l = { k: 'bin', op, l, r: this.and() }; } return l; }
  private and(): Node { let l = this.eq(); while (this.is('&&')) { this.i++; l = { k: 'bin', op: '&&', l, r: this.eq() }; } return l; }
  private eq(): Node { let l = this.rel(); while (['===', '!==', '==', '!='].includes(this.cur.v) && this.cur.t === 'op') { const op = this.cur.v; this.i++; l = { k: 'bin', op, l, r: this.rel() }; } return l; }
  private rel(): Node { let l = this.add(); while (['<', '>', '<=', '>='].includes(this.cur.v) && this.cur.t === 'op') { const op = this.cur.v; this.i++; l = { k: 'bin', op, l, r: this.add() }; } return l; }
  private add(): Node { let l = this.mul(); while ((this.is('+') || this.is('-'))) { const op = this.cur.v; this.i++; l = { k: 'bin', op, l, r: this.mul() }; } return l; }
  private mul(): Node { let l = this.unary(); while (this.is('*') || this.is('/') || this.is('%')) { const op = this.cur.v; this.i++; l = { k: 'bin', op, l, r: this.unary() }; } return l; }
  private unary(): Node {
    if (this.is('!') || this.is('-') || this.is('+')) { const op = this.cur.v; this.i++; return { k: 'un', op, e: this.unary() }; }
    if (this.idIs('typeof')) { this.i++; return { k: 'un', op: 'typeof', e: this.unary() }; }
    return this.postfix();
  }
  private postfix(): Node {
    let e = this.primary();
    for (;;) {
      if (this.maybe('.')) { if (this.cur.t !== 'id') throw new ScriptError('A property name was expected after "."'); e = { k: 'mem', o: e, p: { k: 'lit', v: this.cur.v } }; this.i++; }
      else if (this.maybe('[')) { const p = this.expr(); this.eat(']'); e = { k: 'mem', o: e, p }; }
      else if (this.maybe('(')) { const a: Node[] = []; while (!this.is(')')) { a.push(this.expr()); if (!this.maybe(',')) break; } this.eat(')'); e = { k: 'call', f: e, a }; }
      else return e;
    }
  }
  private primary(): Node {
    const c = this.cur;
    if (c.t === 'num') { this.i++; return { k: 'lit', v: Number(c.v) }; }
    if (c.t === 'str') { this.i++; return { k: 'lit', v: c.v }; }
    if (c.t === 'tpl') { this.i++; return { k: 'tpl', parts: c.parts!.map((p) => (typeof p === 'string' ? p : (() => { const sub = new Parser(p); const e = sub.expr(); if (sub.cur.t !== 'eof') throw new ScriptError('Unexpected text in a template'); return e; })())) }; }
    if (c.t === 'id') {
      if (c.v === 'true') { this.i++; return { k: 'lit', v: true }; }
      if (c.v === 'false') { this.i++; return { k: 'lit', v: false }; }
      if (c.v === 'null') { this.i++; return { k: 'lit', v: null }; }
      if (c.v === 'undefined') { this.i++; return { k: 'lit', v: undefined }; }
      if (c.v === 'function') {
        this.i++; if (this.cur.t === 'id') this.i++; this.eat('('); const params: string[] = [];
        while (this.cur.t === 'id') { params.push(this.cur.v); this.i++; if (!this.maybe(',')) break; }
        this.eat(')'); return { k: 'fn', params, body: this.block() };
      }
      if (KEYWORDS_NOT_SUPPORTED.has(c.v)) throw new ScriptError(`"${c.v}" is not supported in hive-am response handlers`);
      this.i++; return { k: 'id', n: c.v };
    }
    if (this.maybe('(')) { const e = this.expr(); this.eat(')'); return e; }
    if (this.maybe('[')) { const items: Node[] = []; while (!this.is(']')) { items.push(this.expr()); if (!this.maybe(',')) break; } this.eat(']'); return { k: 'arr', items }; }
    if (this.maybe('{')) {
      const props: [string, Node][] = [];
      while (!this.is('}')) {
        const key = this.cur.t === 'id' || this.cur.t === 'str' ? this.cur.v : (() => { throw new ScriptError('A property name was expected'); })(); this.i++;
        if (this.maybe(':')) props.push([key, this.expr()]); else props.push([key, { k: 'id', n: key }]);
        if (!this.maybe(',')) break;
      }
      this.eat('}'); return { k: 'obj', props };
    }
    throw new ScriptError(`Unexpected "${c.v || 'end of the script'}"`);
  }
}

// ------------------------------------------------------------------ evaluation
class Fn { constructor(readonly params: string[], readonly body: Stmt[] | Node, readonly env: Env) {} }
class Native { constructor(readonly name: string, readonly fn: (args: unknown[]) => unknown) {} }
class Return { constructor(readonly value: unknown) {} }
class Assertion extends Error {}
class Env { vars = new Map<string, unknown>(); constructor(readonly parent?: Env) {} get(n: string): unknown { return this.vars.has(n) ? this.vars.get(n) : this.parent?.get(n); } has(n: string): boolean { return this.vars.has(n) || !!this.parent?.has(n); }
  set(n: string, v: unknown) { let e: Env | undefined = this; while (e) { if (e.vars.has(n)) { e.vars.set(n, v); return; } e = e.parent; } this.vars.set(n, v); } }

const BAD_PROPS = new Set(['__proto__', 'constructor', 'prototype', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__']);
const MAX_STEPS = 60_000;
const text = (v: unknown): string => (v === undefined ? 'undefined' : v === null ? 'null' : typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function runScript(script: string, response: ScriptResponse, globals: Record<string, string>): ScriptResult {
  const result: ScriptResult = { tests: [], logs: [], set: [], cleared: [] };
  let program: Stmt[];
  try { program = new Parser(tokenize(script)).program(); } catch (e) { result.error = `This handler uses something hive-am does not support: ${(e as Error).message}`; return result; }

  let steps = 0, depth = 0;
  const tick = () => { if (++steps > MAX_STEPS) throw new ScriptError('The handler did more work than it is allowed to'); };
  const callFn = (f: unknown, args: unknown[]): unknown => {
    tick();
    if (f instanceof Native) return f.fn(args);
    if (!(f instanceof Fn)) throw new ScriptError('That is not a function');
    if (depth >= 100) throw new ScriptError('The handler did more work than it is allowed to (functions call each other too deeply)');
    const env = new Env(f.env); f.params.forEach((p, i) => env.vars.set(p, args[i]));
    depth++;
    try {
      if (!Array.isArray(f.body)) return ev(f.body, env);
      try { run(f.body, env); } catch (r) { if (r instanceof Return) return r.value; throw r; }
      return undefined;
    } finally { depth--; }
  };

  const headersObj = { valueOf: new Native('valueOf', ([n]) => response.headers[String(n).toLowerCase()]), valuesOf: new Native('valuesOf', ([n]) => (response.headers[String(n).toLowerCase()] === undefined ? [] : [response.headers[String(n).toLowerCase()]])) };
  const responseObj = { status: response.status, time: response.time ?? 0, text: response.text, body: response.body, headers: headersObj, contentType: { mimeType: response.contentType.split(';')[0].trim(), charset: /charset=([^;]+)/i.exec(response.contentType)?.[1] ?? 'utf-8' } };
  const clientObj = {
    global: {
      set: new Native('set', ([n, v]) => { const name = text(n); if (!/^[A-Za-z_][\w.-]{0,80}$/.test(name)) throw new ScriptError(`"${name}" is not a valid variable name`); globals[name] = text(v); if (!result.set.includes(name)) result.set.push(name); return undefined; }),
      get: new Native('get', ([n]) => globals[text(n)]),
      clear: new Native('clear', ([n]) => { delete globals[text(n)]; result.cleared.push(text(n)); return undefined; }),
      clearAll: new Native('clearAll', () => { for (const k of Object.keys(globals)) { delete globals[k]; result.cleared.push(k); } return undefined; }),
      isEmpty: new Native('isEmpty', () => Object.keys(globals).length === 0),
    },
    log: new Native('log', (a) => { result.logs.push(a.map(text).join(' ')); return undefined; }),
    assert: new Native('assert', ([c, m]) => { if (!c) throw new Assertion(m === undefined ? 'Assertion failed' : text(m)); return undefined; }),
    test: new Native('test', ([n, f]) => {
      const name = text(n);
      try { callFn(f, []); result.tests.push({ name, passed: true }); }
      catch (e) { if (e instanceof Assertion) result.tests.push({ name, passed: false, message: e.message }); else if (e instanceof ScriptError) result.tests.push({ name, passed: false, message: e.message }); else throw e; }
      return undefined;
    }),
  };
  const root = new Env();
  root.vars.set('response', responseObj); root.vars.set('client', clientObj);
  root.vars.set('JSON', { parse: new Native('parse', ([s]) => { try { return JSON.parse(text(s)); } catch { throw new ScriptError('JSON.parse: the text is not valid JSON'); } }), stringify: new Native('stringify', ([v]) => JSON.stringify(v)) });
  root.vars.set('String', new Native('String', ([v]) => text(v))); root.vars.set('Number', new Native('Number', ([v]) => Number(v)));
  root.vars.set('parseInt', new Native('parseInt', ([v]) => Number.parseInt(text(v), 10))); root.vars.set('parseFloat', new Native('parseFloat', ([v]) => Number.parseFloat(text(v))));
  root.vars.set('Math', { floor: new Native('floor', ([v]) => Math.floor(Number(v))), round: new Native('round', ([v]) => Math.round(Number(v))), min: new Native('min', (a) => Math.min(...a.map(Number))), max: new Native('max', (a) => Math.max(...a.map(Number))) });

  const prop = (o: unknown, p: unknown): unknown => {
    const key = typeof p === 'number' ? p : text(p);
    if (typeof key === 'string' && BAD_PROPS.has(key)) throw new ScriptError(`"${key}" is not available`);
    if (o === null || o === undefined) throw new ScriptError(`Cannot read "${text(key)}" of ${o === null ? 'null' : 'undefined'}`);
    if (typeof o === 'string') {
      if (key === 'length') return o.length; if (typeof key === 'number') return o[key];
      const m: Record<string, (...a: unknown[]) => unknown> = { includes: (x) => o.includes(text(x)), startsWith: (x) => o.startsWith(text(x)), endsWith: (x) => o.endsWith(text(x)), indexOf: (x) => o.indexOf(text(x)), toLowerCase: () => o.toLowerCase(), toUpperCase: () => o.toUpperCase(), trim: () => o.trim(), split: (x) => o.split(text(x)), slice: (a, b) => o.slice(Number(a), b === undefined ? undefined : Number(b)), substring: (a, b) => o.substring(Number(a), b === undefined ? undefined : Number(b)), toString: () => o, replace: (a, b) => o.replace(text(a), text(b)) };
      return key in m ? new Native(String(key), (a) => m[key as string](...a)) : undefined;
    }
    if (Array.isArray(o)) {
      if (key === 'length') return o.length; if (typeof key === 'number') return o[key];
      const fnArg = (f: unknown) => (x: unknown, i: number) => callFn(f, [x, i]);
      const m: Record<string, (...a: unknown[]) => unknown> = { includes: (x) => o.includes(x), indexOf: (x) => o.indexOf(x), join: (s) => o.map(text).join(s === undefined ? ',' : text(s)), slice: (a, b) => o.slice(Number(a), b === undefined ? undefined : Number(b)), map: (f) => o.map(fnArg(f)), filter: (f) => o.filter((x, i) => !!callFn(f, [x, i])), find: (f) => o.find((x, i) => !!callFn(f, [x, i])), some: (f) => o.some((x, i) => !!callFn(f, [x, i])), every: (f) => o.every((x, i) => !!callFn(f, [x, i])) };
      return key in m ? new Native(String(key), (a) => m[key as string](...a)) : undefined;
    }
    if (o instanceof Native || o instanceof Fn) return undefined;
    if (typeof o === 'object') return Object.prototype.hasOwnProperty.call(o, key as string) ? (o as Record<string, unknown>)[key as string] : undefined;
    if (typeof o === 'number' && key === 'toString') return new Native('toString', () => String(o));
    return undefined;
  };

  const ev = (n: Node, env: Env): unknown => {
    tick();
    switch (n.k) {
      case 'lit': return n.v;
      case 'id': if (!env.has(n.n)) { if (n.n === 'undefined') return undefined; throw new ScriptError(`"${n.n}" is not defined`); } return env.get(n.n);
      case 'tpl': return n.parts.map((p) => (typeof p === 'string' ? p : text(ev(p, env)))).join('');
      case 'arr': return n.items.map((x) => ev(x, env));
      case 'obj': return Object.fromEntries(n.props.filter(([k]) => !BAD_PROPS.has(k)).map(([k, v]) => [k, ev(v, env)]));
      case 'mem': return prop(ev(n.o, env), ev(n.p, env));
      case 'call': return callFn(ev(n.f, env), n.a.map((x) => ev(x, env)));
      case 'fn': return new Fn(n.params, n.body, env);
      case 'asg': { if (!env.has(n.n)) throw new ScriptError(`"${n.n}" is not declared`); const v = ev(n.e, env); env.set(n.n, v); return v; }
      case 'cond': return ev(n.c, env) ? ev(n.a, env) : ev(n.b, env);
      case 'un': { const v = ev(n.e, env); return n.op === '!' ? !v : n.op === '-' ? -Number(v) : n.op === '+' ? Number(v) : typeof v === 'object' && v instanceof Fn ? 'function' : v === null ? 'object' : typeof v; }
      case 'bin': {
        if (n.op === '&&') { const l = ev(n.l, env); return l ? ev(n.r, env) : l; }
        if (n.op === '||') { const l = ev(n.l, env); return l ? l : ev(n.r, env); }
        if (n.op === '??') { const l = ev(n.l, env); return l ?? ev(n.r, env); }
        const l = ev(n.l, env), r = ev(n.r, env);
        switch (n.op) {
          case '===': return l === r; case '!==': return l !== r; case '==': return l == r; case '!=': return l != r; // eslint-disable-line eqeqeq
          case '<': return (l as number) < (r as number); case '>': return (l as number) > (r as number); case '<=': return (l as number) <= (r as number); case '>=': return (l as number) >= (r as number);
          case '+': return typeof l === 'string' || typeof r === 'string' ? text(l) + text(r) : Number(l) + Number(r);
          case '-': return Number(l) - Number(r); case '*': return Number(l) * Number(r); case '/': return Number(l) / Number(r); case '%': return Number(l) % Number(r);
        }
        throw new ScriptError(`Unknown operator ${n.op}`);
      }
    }
  };
  const run = (stmts: Stmt[], env: Env) => {
    for (const s of stmts) {
      tick();
      if (s.s === 'decl') env.vars.set(s.n, s.e ? ev(s.e, env) : undefined);
      else if (s.s === 'expr') ev(s.e, env);
      else if (s.s === 'if') run(ev(s.c, env) ? s.a : s.b, new Env(env));
      else throw new Return(s.e ? ev(s.e, env) : undefined);
    }
  };
  try { run(program, root); }
  catch (e) {
    if (e instanceof Return) return result;
    result.error = e instanceof Assertion ? `Assertion failed: ${e.message}` : e instanceof ScriptError ? e.message : `The handler failed: ${(e as Error).message}`;
  }
  return result;
}
