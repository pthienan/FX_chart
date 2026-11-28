'use strict';
// Pine Script (TradingView) → indicator chạy trên chart. Chỉ trong trình duyệt.

const Pine = (() => {
  class PineError extends Error {
    constructor(msg, line) {
      super(line ? `${msg} (dòng ${line})` : msg);
      this.line = line;
    }
  }

  const COLORS = {
    red: '#f23645', green: '#089981', blue: '#2962ff', white: '#ffffff', black: '#000000',
    yellow: '#fdd835', orange: '#ff9800', purple: '#9c27b0', teal: '#00897b', lime: '#00e676',
    gray: '#787b86', grey: '#787b86', silver: '#b2b5be', maroon: '#880e4f', navy: '#1a237e',
    aqua: '#00bcd4', fuchsia: '#e040fb', olive: '#808000',
  };
  const DAYS = { sunday: 1, monday: 2, tuesday: 3, wednesday: 4, thursday: 5, friday: 6, saturday: 7 };
  const KEYWORDS = new Set(['if', 'else', 'for', 'to', 'by', 'while', 'switch', 'and', 'or', 'not', 'var', 'varip', 'break', 'continue', 'import', 'export', 'method', 'enum', 'true', 'false', 'na']);
  const SRC = new Set(['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4']);
  const TA_OK = new Set('sma ema rma wma vwma swma hma stdev highest lowest highestbars lowestbars change mom roc tr atr rsi cum crossover crossunder cross pivothigh pivotlow valuewhen barssince rising falling bb macd stoch cci linreg range'.split(' '));
  const MATH_OK = new Set('abs max min round floor ceil pow sqrt log log10 exp sign avg'.split(' '));
  const ARR_OK = new Set('new_float new_int new_bool new_string new_line new_label new_color get set push pop shift unshift size clear last first includes remove insert copy concat slice fill'.split(' '));
  const LINE_OK = new Set('new delete set_xy1 set_xy2 set_x1 set_y1 set_x2 set_y2 set_color set_width set_style set_extend set_xloc get_x1 get_y1 get_x2 get_y2'.split(' '));
  const LAB_OK = new Set('new delete set_text set_xy set_x set_y set_color set_textcolor set_style set_size set_tooltip get_x get_y get_text'.split(' '));
  const STR_OK = new Set('tostring format length contains startswith endswith lower upper replace split'.split(' '));
  const ROOTS = new Set('ta math color input str line label array plot hline shape location size display format xloc yloc extend font barstate syminfo timeframe dayofweek session runtime log chart alert'.split(' '));

  function looksLike(code) {
    return /\/\/@version\s*=\s*\d+/.test(code) || /(^|\n)\s*(indicator|study|strategy)\s*\(/.test(code);
  }

  function compile(code) {
    if (typeof code !== 'string' || !code.trim()) throw new PineError('Chưa có code');
    const ast = parse(code);
    const meta = analyze(ast);
    const def = {
      name: meta.name,
      pane: meta.overlay ? 'main' : 'sub',
      precision: meta.precision,
      params: meta.params,
      plots: meta.plots,
      recompute: meta.recompute,
      compute(bars, p) { return execute(ast, meta, bars || [], p || {}); },
    };
    const fake = [];
    for (let i = 0; i < 60; i++) {
      const c = 1.1 + Math.sin(i / 5) * 0.02;
      fake.push({ time: 1700000000 + i * 900, open: c - 0.001, high: c + 0.004, low: c - 0.004, close: c });
    }
    const defaults = {};
    for (const prm of meta.params) defaults[prm.id] = prm.default;
    execute(ast, meta, fake, defaults);
    return def;
  }

  function blankComments(src) {
    let out = '', i = 0, q = '';
    while (i < src.length) {
      const c = src[i];
      if (q) {
        out += c;
        if (c === '\\') { out += src[i + 1] || ''; i += 2; continue; }
        if (c === q) q = '';
        i++;
        continue;
      }
      if (c === "'" || c === '"') { q = c; out += c; i++; continue; }
      if (c === '/' && src[i + 1] === '/') {
        while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
        continue;
      }
      if (c === '/' && src[i + 1] === '*') {
        out += '  '; i += 2;
        while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
          out += src[i] === '\n' ? '\n' : ' ';
          i++;
        }
        if (i < src.length) { out += '  '; i += 2; }
        continue;
      }
      out += c; i++;
    }
    return out;
  }

  function indentOf(line) {
    let n = 0;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === ' ') n++;
      else if (line[i] === '\t') n += 4;
      else break;
    }
    return n;
  }

  function parenDepth(text) {
    let d = 0, q = '';
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '\\') { i++; continue; } if (c === q) q = ''; continue; }
      if (c === "'" || c === '"') { q = c; continue; }
      if (c === '(' || c === '[' || c === '{') d++;
      else if (c === ')' || c === ']' || c === '}') d--;
    }
    return d;
  }

  function needsJoin(text) {
    const d = parenDepth(text);
    if (d > 0) return true;
    const t = text.trim();
    if (/=>$/.test(t)) return false;
    if (/(?:and|or|not)$/.test(t)) return true;
    if (/=\s*$/.test(t)) return true;
    return /[+\-*/%,?:<>!]$/.test(t);
  }

  function logicalLines(src) {
    const raw = blankComments(src).split(/\r?\n/);
    const lines = [];
    let buf = '', startLine = 1, startIndent = 0;
    const flush = () => {
      if (parenDepth(buf) > 0) throw new PineError('Thiếu dấu đóng ngoặc', startLine);
      lines.push({ line: startLine, indent: startIndent, text: buf.trim() });
      buf = '';
    };
    for (let i = 0; i < raw.length; i++) {
      const stripped = raw[i].trim();
      if (!stripped) { if (buf && needsJoin(buf)) continue; if (buf) flush(); continue; }
      if (!buf) { startLine = i + 1; startIndent = indentOf(raw[i]); buf = stripped; }
      else buf += ' ' + stripped;
      if (needsJoin(buf)) continue;
      flush();
    }
    if (buf) flush();
    return lines;
  }

  function parse(src) {
    const lines = logicalLines(src);
    if (!lines.length) throw new PineError('Code Pine trống');
    let lineIdx = -1, tokens = [], ti = 0, seq = 0;
    const nid = () => ++seq;
    const cur = () => tokens[ti];
    const lineNo = () => (cur() ? cur().line : lines[Math.max(0, lineIdx)].line);
    const unexpected = () => new PineError(`Không đọc được "${cur() ? cur().v : 'cuối dòng'}"`, lineNo());
    const checkT = (t) => cur() && cur().t === t;
    const checkOp = (v) => cur() && cur().t === 'op' && cur().v === v;
    const checkKw = (v) => cur() && cur().t === 'kw' && cur().v === v;
    const eat = () => tokens[ti++];
    const eatOp = (v) => { if (checkOp(v)) { ti++; return true; } return false; };
    const eatKw = (v) => { if (checkKw(v)) { ti++; return true; } return false; };
    const expectOp = (v) => { if (!eatOp(v)) throw unexpected(); };
    const expectKw = (v) => { if (!eatKw(v)) throw unexpected(); };
    const expectId = () => { if (!checkT('id')) throw unexpected(); return eat().v; };

    function lex(text, line) {
      const out = [];
      let i = 0;
      const isD = (c) => c >= '0' && c <= '9';
      const isA = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
      while (i < text.length) {
        const c = text[i];
        if (c === ' ' || c === '\t') { i++; continue; }
        if (c === '#') {
          let h = '';
          i++;
          while (i < text.length && /[0-9a-fA-F]/.test(text[i]) && h.length < 8) { h += text[i++]; }
          if (h.length !== 3 && h.length !== 6 && h.length !== 8) throw new PineError('Màu không hợp lệ', line);
          if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
          out.push({ t: 'color', v: '#' + h.slice(0, 6).toLowerCase(), line });
          continue;
        }
        if (c === "'" || c === '"') {
          const q = c;
          let s = '';
          i++;
          while (i < text.length && text[i] !== q) {
            if (text[i] === '\\') { s += text[i + 1] || ''; i += 2; continue; }
            s += text[i++];
          }
          if (text[i] !== q) throw new PineError('Thiếu dấu nháy', line);
          i++;
          out.push({ t: 'str', v: s, line });
          continue;
        }
        if (isD(c) || (c === '.' && isD(text[i + 1]))) {
          let s = '';
          while (i < text.length && /[0-9.]/.test(text[i])) s += text[i++];
          if (text[i] === 'e' || text[i] === 'E') {
            s += text[i++];
            if (text[i] === '+' || text[i] === '-') s += text[i++];
            while (isD(text[i])) s += text[i++];
          }
          const n = Number(s);
          if (!Number.isFinite(n)) throw new PineError('Số không hợp lệ', line);
          out.push({ t: 'num', v: n, line });
          continue;
        }
        if (isA(c)) {
          let s = '';
          while (i < text.length && (isA(text[i]) || isD(text[i]))) s += text[i++];
          out.push(KEYWORDS.has(s) ? { t: 'kw', v: s, line } : { t: 'id', v: s, line });
          continue;
        }
        const two = text.slice(i, i + 2);
        if (['=>', ':=', '==', '!=', '>=', '<='].includes(two)) { out.push({ t: 'op', v: two, line }); i += 2; continue; }
        if ('+-*/%<>?:.,()[]{}='.includes(c)) { out.push({ t: 'op', v: c, line }); i++; continue; }
        throw new PineError(`Ký tự lạ "${c}"`, line);
      }
      return out;
    }

    function load() { tokens = lex(lines[lineIdx].text, lines[lineIdx].line); ti = 0; }
    function peekGeneric() {
      if (!checkOp('<')) return false;
      let i = ti + 1;
      while (i < tokens.length && tokens[i].v !== '>') {
        const t = tokens[i];
        if (!(t.t === 'id' || t.v === ',' || t.v === '.')) return false;
        i++;
      }
      return tokens[i] && tokens[i].v === '>' && tokens[i + 1] && tokens[i + 1].v === '(';
    }
    function parseArgs() {
      const args = [];
      if (eatOp(')')) return args;
      while (true) {
        let name = null;
        if (checkT('id') && tokens[ti + 1] && tokens[ti + 1].v === '=') { name = eat().v; eatOp('='); }
        args.push({ name, value: parseExpr() });
        if (eatOp(')')) break;
        expectOp(',');
        if (eatOp(')')) break;
      }
      return args;
    }
    function parsePostfix() {
      let e = parsePrimary();
      while (true) {
        if (checkOp('<') && peekGeneric()) {
          eatOp('<');
          while (!checkOp('>')) { if (!cur()) throw unexpected(); eat(); }
          eatOp('>');
          continue;
        }
        if (eatOp('(')) { e = { kind: 'call', callee: e, args: parseArgs(), line: e.line, id: nid() }; continue; }
        if (eatOp('[')) {
          const index = parseExpr();
          expectOp(']');
          e = { kind: 'index', base: e, index, line: e.line, id: nid() };
          continue;
        }
        if (eatOp('.')) {
          e = { kind: 'member', obj: e, prop: expectId(), line: e.line, id: nid() };
          continue;
        }
        break;
      }
      return e;
    }
    function parsePrimary() {
      const line = lineNo();
      if (checkKw('if')) return parseIf(lines[lineIdx].indent);
      if (checkKw('switch')) return parseSwitch(lines[lineIdx].indent);
      if (eatKw('true')) return { kind: 'bool', value: true, line, id: nid() };
      if (eatKw('false')) return { kind: 'bool', value: false, line, id: nid() };
      if (eatKw('na')) return { kind: 'na', line, id: nid() };
      if (checkT('num')) return { kind: 'num', value: eat().v, line, id: nid() };
      if (checkT('str')) return { kind: 'str', value: eat().v, line, id: nid() };
      if (checkT('color')) return { kind: 'color', hex: eat().v, line, id: nid() };
      if (checkT('id')) return { kind: 'id', name: eat().v, line, id: nid() };
      if (eatOp('(')) { const e = parseExpr(); expectOp(')'); return e; }
      if (eatOp('[')) {
        const items = [];
        if (!checkOp(']')) {
          while (true) {
            items.push(parseExpr());
            if (!eatOp(',')) break;
            if (checkOp(']')) break;
          }
        }
        expectOp(']');
        return { kind: 'array', items, line, id: nid() };
      }
      throw unexpected();
    }
    function parseUnary() {
      const line = lineNo();
      if (eatKw('not')) return { kind: 'unary', op: 'not', expr: parseUnary(), line, id: nid() };
      if (eatOp('-') || eatOp('+')) {
        const op = tokens[ti - 1].v;
        return { kind: 'unary', op, expr: parseUnary(), line, id: nid() };
      }
      return parsePostfix();
    }
    function left(parseNext, ops, kw) {
      return function parseLevel() {
        let e = parseNext();
        while ((ops && ops.some((op) => checkOp(op) && eatOp(op))) || (kw && kw.some((k) => checkKw(k) && eatKw(k)))) {
          const op = tokens[ti - 1].v;
          e = { kind: 'binary', op, l: e, r: parseNext(), line: e.line, id: nid() };
        }
        return e;
      };
    }
    const parseMul = left(parseUnary, ['*', '/', '%']);
    const parseAdd = left(parseMul, ['+', '-']);
    const parseCmp = left(parseAdd, ['>', '<', '>=', '<=']);
    const parseEq = left(parseCmp, ['==', '!=']);
    const parseAnd = left(parseEq, null, ['and']);
    const parseOr = left(parseAnd, null, ['or']);
    function parseExpr() {
      const e = parseOr();
      if (!eatOp('?')) return e;
      const a = parseExpr();
      expectOp(':');
      const b = parseExpr();
      return { kind: 'ternary', cond: e, a, b, line: e.line, id: nid() };
    }
    function parseBody(indent) {
      if (ti < tokens.length) {
        const e = parseExpr();
        if (ti < tokens.length) throw unexpected();
        return [{ kind: 'expr', expr: e, line: lineNo(), id: nid() }];
      }
      const body = [];
      while (lineIdx + 1 < lines.length && lines[lineIdx + 1].indent > indent) {
        lineIdx++;
        load();
        body.push(parseStmt());
      }
      if (!body.length) throw new PineError('Thiếu khối lệnh. Kiểm tra thụt dòng.', lines[lineIdx].line);
      return body;
    }
    function parseIf(indent) {
      const line = lines[lineIdx].line;
      expectKw('if');
      const cond = parseExpr();
      if (ti < tokens.length) throw new PineError('if phải xuống dòng cho phần bên trong', line);
      const thenB = parseBody(indent);
      let els = null;
      const nxt = lines[lineIdx + 1];
      if (nxt && nxt.indent === indent && /^else(\s|$)/.test(nxt.text)) {
        lineIdx++;
        load();
        expectKw('else');
        if (checkKw('if')) els = [parseIf(indent)];
        else if (ti < tokens.length) {
          const e = parseExpr();
          if (ti < tokens.length) throw unexpected();
          els = [{ kind: 'expr', expr: e, line, id: nid() }];
        } else els = parseBody(indent);
      }
      return { kind: 'if', cond, then: thenB, else: els, line, id: nid() };
    }
    function parseFor(indent) {
      const line = lines[lineIdx].line;
      expectKw('for');
      if (checkOp('[')) throw new PineError('Chưa hỗ trợ for ... in', line);
      const name = expectId();
      expectOp('=');
      const from = parseExpr();
      expectKw('to');
      const to = parseExpr();
      const by = eatKw('by') ? parseExpr() : null;
      if (ti < tokens.length) throw unexpected();
      return { kind: 'for', name, from, to, by, body: parseBody(indent), line, id: nid() };
    }
    function parseWhile(indent) {
      const line = lines[lineIdx].line;
      expectKw('while');
      const cond = parseExpr();
      if (ti < tokens.length) throw unexpected();
      return { kind: 'while', cond, body: parseBody(indent), line, id: nid() };
    }
    function parseSwitch(indent) {
      const line = lines[lineIdx].line;
      expectKw('switch');
      let expr = null;
      if (ti < tokens.length) { expr = parseExpr(); if (ti < tokens.length) throw unexpected(); }
      const arms = [];
      while (lineIdx + 1 < lines.length && lines[lineIdx + 1].indent > indent) {
        lineIdx++;
        load();
        const armIndent = lines[lineIdx].indent;
        const armLine = lines[lineIdx].line;
        const cond = checkOp('=>') ? null : parseExpr();
        expectOp('=>');
        let body;
        if (ti < tokens.length) {
          const e = parseExpr();
          if (ti < tokens.length) throw unexpected();
          body = [{ kind: 'expr', expr: e, line: armLine, id: nid() }];
        } else body = parseBody(armIndent);
        arms.push({ cond, body });
      }
      if (!arms.length) throw new PineError('switch chưa có nhánh', line);
      return { kind: 'switch', expr, arms, line, id: nid() };
    }
    function isFuncDef() {
      if (!checkT('id') || !tokens[ti + 1] || tokens[ti + 1].v !== '(') return false;
      let d = 0;
      for (let k = ti + 1; k < tokens.length; k++) {
        if (tokens[k].v === '(') d++;
        else if (tokens[k].v === ')') { d--; if (d === 0) return tokens[k + 1] && tokens[k + 1].v === '=>'; }
      }
      return false;
    }
    function looksAssign() {
      let d = 0;
      for (let k = ti; k < tokens.length; k++) {
        const v = tokens[k].v;
        if (v === '(' || v === '[') d++;
        else if (v === ')' || v === ']') d--;
        else if (d === 0 && v === '=>') return false;
        else if (d === 0 && (v === '=' || v === ':=')) return true;
      }
      return false;
    }
    function parseParams() {
      expectOp('(');
      const params = [];
      if (eatOp(')')) return params;
      while (true) {
        const ids = [];
        while (checkT('id')) ids.push(eat().v);
        if (!ids.length) throw unexpected();
        const name = ids.pop();
        const def = eatOp('=') ? parseExpr() : null;
        params.push({ name, def });
        if (eatOp(')')) break;
        expectOp(',');
        if (eatOp(')')) break;
      }
      return params;
    }
    function parseFunc(indent) {
      const line = lines[lineIdx].line;
      const name = expectId();
      const params = parseParams();
      expectOp('=>');
      const body = parseBody(indent);
      return { kind: 'func', name, params, body, line, id: nid() };
    }
    function parseTuple(isVar) {
      const line = lines[lineIdx].line;
      expectOp('[');
      const names = [];
      while (!checkOp(']')) {
        const ids = [];
        while (checkT('id')) ids.push(eat().v);
        if (!ids.length) throw unexpected();
        names.push(ids.pop());
        if (!eatOp(',')) break;
      }
      expectOp(']');
      const op = checkOp(':=') ? eat().v : (expectOp('='), '=');
      const expr = parseExpr();
      if (ti < tokens.length) throw unexpected();
      return { kind: 'tuple', names, isVar, op, expr, line, id: nid() };
    }
    function parseAssign(isVar) {
      const line = lines[lineIdx].line;
      if (checkOp('[')) return parseTuple(isVar);
      const ids = [];
      while (checkT('id')) ids.push(eat().v);
      if (!ids.length) throw unexpected();
      const name = ids.pop();
      const op = checkOp(':=') ? eat().v : (expectOp('='), '=');
      const expr = parseExpr();
      if (ti < tokens.length) throw unexpected();
      return { kind: 'assign', name, isVar, op, expr, line, id: nid() };
    }
    function parseStmt() {
      const indent = lines[lineIdx].indent;
      const line = lines[lineIdx].line;
      if (checkKw('import') || checkKw('export') || checkKw('method') || checkKw('enum')) {
        throw new PineError(`Chưa hỗ trợ "${cur().v}"`, line);
      }
      if (checkT('id') && cur().v === 'type' && tokens[ti + 1] && tokens[ti + 1].t === 'id') {
        throw new PineError('Chưa hỗ trợ "type"', line);
      }
      if (checkKw('if')) return parseIf(indent);
      if (checkKw('for')) return parseFor(indent);
      if (checkKw('while')) return parseWhile(indent);
      if (checkKw('switch')) return parseSwitch(indent);
      if (checkKw('break')) { eat(); return { kind: 'break', line, id: nid() }; }
      if (checkKw('continue')) { eat(); return { kind: 'continue', line, id: nid() }; }
      if (checkKw('else')) throw new PineError('else không có if', line);
      if (isFuncDef()) return parseFunc(indent);
      let isVar = false;
      if (checkKw('var') || checkKw('varip')) { eat(); isVar = true; }
      if (looksAssign() || isVar) return parseAssign(isVar);
      const expr = parseExpr();
      if (ti < tokens.length) throw unexpected();
      return { kind: 'expr', expr, line, id: nid() };
    }

    const body = [];
    while (lineIdx + 1 < lines.length) { lineIdx++; load(); body.push(parseStmt()); }
    return body;
  }

  function calleeName(e) {
    if (!e) return '';
    if (e.kind === 'id') return e.name;
    if (e.kind === 'na') return 'na';
    if (e.kind === 'member') return calleeName(e.obj) + '.' + e.prop;
    return '';
  }
  function named(call, name) {
    const a = call.args.find((x) => x.name === name);
    return a ? a.value : null;
  }
  function positional(call) { return call.args.filter((a) => !a.name).map((a) => a.value); }
  function paintConst(base, transp) {
    if (typeof base !== 'string') return undefined;
    const m = /^#([0-9a-f]{6})$/i.exec(base);
    if (!m) return base.startsWith('rgba') ? base : undefined;
    const t = Math.max(0, Math.min(100, Number(transp) || 0));
    if (!t) return '#' + m[1].toLowerCase();
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${(1 - t / 100).toFixed(3)})`;
  }
  function constEval(e) {
    if (!e) return undefined;
    if (e.kind === 'num' || e.kind === 'str' || e.kind === 'bool') return e.value;
    if (e.kind === 'na') return null;
    if (e.kind === 'color') return e.hex;
    if (e.kind === 'unary' && e.op === '-' && e.expr.kind === 'num') return -e.expr.value;
    if (e.kind === 'member' && e.obj.kind === 'id' && e.obj.name === 'color' && COLORS[e.prop]) return COLORS[e.prop];
    if (e.kind === 'id' && SRC.has(e.name)) return { source: e.name };
    if (e.kind === 'array') return e.items.map(constEval);
    if (e.kind === 'call') {
      const n = calleeName(e.callee);
      const pos = positional(e);
      if (n === 'color.new') return paintConst(constEval(named(e, 'color') || pos[0]), constNum(named(e, 'transp') || pos[1]));
      if (n === 'color.rgb') {
        const r = constNum(pos[0]), g = constNum(pos[1]), b = constNum(pos[2]);
        if (r == null || g == null || b == null) return undefined;
        const hex = '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
        return paintConst(hex, constNum(named(e, 'transp') || pos[3]));
      }
    }
    return undefined;
  }
  const constStr = (e) => (typeof constEval(e) === 'string' ? constEval(e) : null);
  const constNum = (e) => { const v = constEval(e); return typeof v === 'number' ? v : null; };
  function memberStr(e) {
    if (e && e.kind === 'member' && e.obj.kind === 'id') return e.obj.name + '.' + e.prop;
    return '';
  }
  function slug(s) {
    const t = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24);
    return t && !/^[0-9]/.test(t) ? t : '';
  }
  function clampWidth(w) {
    const n = Math.round(Number(w) || 1);
    return Math.max(1, Math.min(4, n));
  }

  function analyze(ast) {
    const meta = { name: 'Pine', overlay: false, precision: null, params: [], plots: [], recompute: false, hasMarks: false };
    const used = new Set();
    const uniq = (base) => {
      let id = base, n = 2;
      while (used.has(id)) id = base + '_' + (n++);
      used.add(id);
      return id;
    };
    function noteCall(e, inFunc) {
      const name = calleeName(e.callee);
      if (!name) return;
      if (e.args.some((a) => a.name === 'offset')) meta.recompute = true;
      if (name === 'strategy' || name.startsWith('strategy.')) throw new PineError('Ô này chạy indicator, chưa chạy strategy', e.line);
      if (name.startsWith('request.')) throw new PineError('Chưa hỗ trợ ' + name + ' (khung giờ hoặc symbol khác)', e.line);
      if (/^(table|matrix|map|box|polyline)\./.test(name)) throw new PineError('Chưa hỗ trợ "' + name + '"', e.line);
      const root = name.split('.')[0];
      if (name.includes('.') && !ROOTS.has(root)) throw new PineError('Chưa hỗ trợ "' + name + '"', e.line);
      if (name.startsWith('ta.') && !TA_OK.has(name.slice(3))) throw new PineError('Chưa hỗ trợ "' + name + '"', e.line);
      if (name.startsWith('math.') && !MATH_OK.has(name.slice(5))) throw new PineError('Chưa hỗ trợ "' + name + '"', e.line);
      if (name.startsWith('array.') && !ARR_OK.has(name.slice(6))) throw new PineError('Chưa hỗ trợ "' + name + '"', e.line);
      if (name.startsWith('line.') && !LINE_OK.has(name.slice(5))) throw new PineError('Chưa hỗ trợ "' + name + '"', e.line);
      if (name.startsWith('label.') && !LAB_OK.has(name.slice(6))) throw new PineError('Chưa hỗ trợ "' + name + '"', e.line);
      if (name.startsWith('str.') && !STR_OK.has(name.slice(4))) throw new PineError('Chưa hỗ trợ "' + name + '"', e.line);
      if ((name === 'input' || name.startsWith('input.')) && !/^(input|input\.(int|float|bool|string|source|color|timeframe|session|price|time|text_area|symbol))$/.test(name)) {
        throw new PineError('Chưa hỗ trợ "' + name + '"', e.line);
      }
      if (name === 'indicator' || name === 'study') noteHeader(e);
      else if (name === 'input' || name.startsWith('input.')) noteInput(e, name, inFunc);
      else if (name === 'plot' || name === 'hline') notePlot(e, name, inFunc);
      else if (name === 'plotshape' || name === 'plotchar') { if (inFunc) throw new PineError(name + '() phải nằm ngoài hàm', e.line); meta.hasMarks = true; meta.recompute = true; }
      else if (name === 'line.new' || name === 'label.new' || name === 'ta.pivothigh' || name === 'ta.pivotlow') meta.recompute = true;
    }
    function noteHeader(e) {
      if (meta.saw) throw new PineError('Chỉ một indicator()', e.line);
      meta.saw = true;
      const pos = positional(e);
      meta.name = constStr(named(e, 'title')) || constStr(pos[0]) || meta.name;
      const ov = named(e, 'overlay');
      meta.overlay = ov ? constEval(ov) === true : false;
      const prec = constNum(named(e, 'precision'));
      if (prec != null) meta.precision = prec;
    }
    function noteInput(e, name, inFunc) {
      if (inFunc) throw new PineError('input() phải nằm ngoài hàm', e.line);
      const kind = name === 'input' ? '' : name.slice(6);
      const pos = positional(e);
      let defExpr = named(e, 'defval') || pos[0] || null;
      let title = constStr(named(e, 'title'));
      if (!title && kind && pos[1] && pos[1].kind === 'str') title = pos[1].value;
      if (!title && !kind && named(e, 'defval') && pos[0] && pos[0].kind === 'str') title = pos[0].value;
      if (!title) title = 'Tham số';
      const defEval = constEval(defExpr);
      const prm = { id: uniq(slug(title) || ('in' + meta.params.length)), label: title };
      const grp = constStr(named(e, 'group'));
      if (grp) prm.group = grp;
      if (kind === 'source' || (defEval && defEval.source)) {
        prm.type = 'source'; prm.default = (defEval && defEval.source) || 'close';
      } else if (kind === 'bool' || typeof defEval === 'boolean') {
        prm.type = 'bool'; prm.default = typeof defEval === 'boolean' ? defEval : false;
      } else if (kind === 'color') {
        prm.type = 'color'; prm.default = typeof defEval === 'string' ? defEval : '#2962ff';
      } else if (kind === 'string' || kind === 'text_area' || kind === 'symbol' || kind === 'timeframe' || kind === 'session' || kind === 'time' || typeof defEval === 'string') {
        const opts = constEval(named(e, 'options'));
        if (Array.isArray(opts) && opts.length && opts.every((x) => typeof x === 'string')) {
          prm.type = 'select'; prm.options = opts; prm.default = typeof defEval === 'string' ? defEval : opts[0];
        } else { prm.type = 'text'; prm.default = typeof defEval === 'string' ? defEval : ''; }
      } else {
        prm.type = 'number'; prm.default = typeof defEval === 'number' ? defEval : 0;
        const minV = constNum(named(e, 'minval')) ?? constNum(pos[2]);
        const maxV = constNum(named(e, 'maxval')) ?? constNum(pos[3]);
        const step = constNum(named(e, 'step'));
        if (minV != null) prm.min = minV;
        if (maxV != null) prm.max = maxV;
        prm.step = step != null ? step : (kind === 'float' || kind === 'price' ? 0.01 : 1);
      }
      e.paramId = prm.id;
      meta.params.push(prm);
    }
    function notePlot(e, kind, inFunc) {
      if (inFunc) throw new PineError(kind + '() phải nằm ngoài hàm', e.line);
      const disp = memberStr(named(e, 'display'));
      if (disp === 'display.none') { e.hidden = true; return; }
      const pos = positional(e);
      const title = constStr(named(e, 'title')) || constStr(pos[1]) || (kind === 'hline' ? 'Level' : 'Plot');
      const color = (kind === 'hline' ? constStr(named(e, 'color')) || constEval(pos[2]) : constEval(named(e, 'color')) || constEval(pos[2])) || '#2962ff';
      const hex = typeof color === 'string' && (color.startsWith('#') || color.startsWith('rgba')) ? color : '#2962ff';
      const styleM = memberStr(named(e, 'style')) || memberStr(named(e, 'linestyle')) || memberStr(kind === 'hline' ? pos[3] : pos[4]);
      const width = constNum(named(e, 'linewidth'));
      const id = 'p' + meta.plots.length;
      e.plotId = id;
      const pl = { id, title, color: hex, lineWidth: clampWidth(width || 1) };
      if (/histogram|column|area/.test(styleM)) pl.type = 'histogram';
      if (/dotted/.test(styleM)) pl.style = 'dotted';
      else if (/dashed/.test(styleM)) pl.style = 'dashed';
      meta.plots.push(pl);
    }
    function visitExpr(e, inFunc) {
      if (!e || typeof e !== 'object') return;
      if (e.kind === 'call') {
        visitExpr(e.callee, inFunc);
        for (const a of e.args) visitExpr(a.value, inFunc);
        noteCall(e, inFunc);
        return;
      }
      if (e.kind === 'binary') { visitExpr(e.l, inFunc); visitExpr(e.r, inFunc); return; }
      if (e.kind === 'unary') { visitExpr(e.expr, inFunc); return; }
      if (e.kind === 'ternary') { visitExpr(e.cond, inFunc); visitExpr(e.a, inFunc); visitExpr(e.b, inFunc); return; }
      if (e.kind === 'index') { visitExpr(e.base, inFunc); visitExpr(e.index, inFunc); return; }
      if (e.kind === 'member') {
        visitExpr(e.obj, inFunc);
        if (e.obj.kind === 'id' && e.obj.name === 'barstate' && (e.prop === 'islast' || e.prop === 'isrealtime')) meta.recompute = true;
        return;
      }
      if (e.kind === 'array') { for (const it of e.items) visitExpr(it, inFunc); return; }
      if (e.kind === 'if') { visitExpr(e.cond, inFunc); visitStmts(e.then, inFunc); if (e.else) visitStmts(e.else, inFunc); return; }
      if (e.kind === 'switch') {
        if (e.expr) visitExpr(e.expr, inFunc);
        for (const a of e.arms) { if (a.cond) visitExpr(a.cond, inFunc); visitStmts(a.body, inFunc); }
        return;
      }
      if (e.kind === 'id' && e.name === 'last_bar_index') meta.recompute = true;
    }
    function visitStmts(stmts, inFunc) { for (const s of stmts) visitStmt(s, inFunc); }
    function visitStmt(s, inFunc) {
      if (!s) return;
      if (s.kind === 'func') { visitStmts(s.body, true); return; }
      if (s.kind === 'if') { visitExpr(s, inFunc); return; }
      if (s.kind === 'switch') { visitExpr(s, inFunc); return; }
      if (s.kind === 'for') {
        visitExpr(s.from, inFunc); visitExpr(s.to, inFunc); if (s.by) visitExpr(s.by, inFunc);
        visitStmts(s.body, inFunc); return;
      }
      if (s.kind === 'while') { visitExpr(s.cond, inFunc); visitStmts(s.body, inFunc); return; }
      if (s.kind === 'assign' || s.kind === 'tuple') visitExpr(s.expr, inFunc);
      if (s.kind === 'expr') visitExpr(s.expr, inFunc);
    }
    visitStmts(ast, false);
    if (meta.precision == null && !meta.overlay) meta.precision = 2;
    if (!meta.plots.length) meta.plots.push({ id: 'p0', title: meta.name, color: '#2962ff', legend: false });
    return meta;
  }

  function execute(ast, meta, bars, params) {
    const n = bars.length;
    const out = {}, colorOf = {}, marks = [], lines = [], labels = [];
    let barColor = null, usedColor = false;
    for (const pl of meta.plots) { out[pl.id] = new Array(n).fill(null); colorOf[pl.id] = new Array(n).fill(null); }
    const varList = [], frames = new Map(), taMem = new Map(), counts = new Map(), hist = new Map();
    const loops = [];
    let bar = 0;
    const root = { key: 'root', series: new Map(), funcs: new Map() };
    const stack = [root];
    const builtins = new Map();

    function makeSeries(isVar) {
      const s = { values: new Array(n), set: new Uint8Array(n), isVar: !!isVar, inited: false };
      if (isVar) varList.push(s);
      return s;
    }
    function fillSeries(fn) {
      const s = { values: new Array(n), full: true };
      for (let i = 0; i < n; i++) s.values[i] = fn(i);
      return s;
    }
    function readAt(s, index) {
      if (!s || index < 0 || index >= n) return null;
      if (s.full) return s.values[index] == null ? null : s.values[index];
      if (s.set[index]) return s.values[index] == null ? null : s.values[index];
      if (s.isVar) {
        for (let k = index - 1; k >= 0; k--) if (s.set[k]) return s.values[k] == null ? null : s.values[k];
      }
      return null;
    }
    function lookupSeries(name) {
      for (let i = stack.length - 1; i >= 0; i--) {
        const s = stack[i].series.get(name);
        if (s) return s;
      }
      return builtins.get(name) || null;
    }
    function define(name, isVar) {
      const frame = stack[stack.length - 1];
      let s = frame.series.get(name);
      if (!s) { s = makeSeries(isVar); frame.series.set(name, s); }
      else if (isVar && !s.isVar) { s.isVar = true; varList.push(s); }
      return s;
    }
    function lookupFunc(name) {
      if (!name || name.includes('.')) return null;
      for (let i = stack.length - 1; i >= 0; i--) {
        const f = stack[i].funcs.get(name);
        if (f) return f;
      }
      return null;
    }
    function siteKey(node) {
      const parent = stack[stack.length - 1].key;
      const id = parent + '/' + node.id;
      const k = counts.get(id) || 0;
      counts.set(id, k + 1);
      return id + '#' + k;
    }
    function mem(key) {
      let s = taMem.get(key);
      if (!s) { s = {}; taMem.set(key, s); }
      return s;
    }
    const asNum = (v) => {
      if (typeof v === 'boolean') return v ? 1 : 0;
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    };
    const truthy = (v) => !(v == null || v === false || v === 0 || v === '');
    function eq(a, b) {
      if (a == null || b == null) return false;
      return a === b;
    }
    function ne(a, b) { return a == null || b == null ? true : a !== b; }
    function rgbOf(hex) {
      const n = parseInt(hex.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    function hexOf(r, g, b) {
      const h = (x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0');
      return '#' + h(r) + h(g) + h(b);
    }
    function asColor(v) {
      if (v == null) return null;
      if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) return { hex: v.toLowerCase(), t: 0 };
      if (typeof v === 'object' && v.hex) return v;
      return null;
    }
    function cssColor(c) {
      const col = asColor(c);
      if (!col) return c == null ? undefined : undefined;
      if (col.t >= 100) return null;
      if (!col.t) return col.hex;
      const [r, g, b] = rgbOf(col.hex);
      return `rgba(${r},${g},${b},${(1 - col.t / 100).toFixed(3)})`;
    }
    function argAt(args, name, index) {
      if (name) {
        const hit = args.find((a) => a.name === name);
        if (hit) return hit.value;
      }
      const pos = args.filter((a) => !a.name);
      return index != null && pos[index] ? pos[index].value : undefined;
    }
    function hasArg(args, name, index) {
      if (name && args.some((a) => a.name === name)) return true;
      const pos = args.filter((a) => !a.name);
      return index != null && !!pos[index];
    }

    const px = (i, name) => {
      const b = bars[i];
      if (name === 'open') return b.open;
      if (name === 'high') return b.high;
      if (name === 'low') return b.low;
      if (name === 'hl2') return (b.high + b.low) / 2;
      if (name === 'hlc3') return (b.high + b.low + b.close) / 3;
      if (name === 'ohlc4') return (b.open + b.high + b.low + b.close) / 4;
      return b.close;
    };
    for (const name of SRC) builtins.set(name, fillSeries((i) => px(i, name)));
    builtins.set('volume', fillSeries(() => 1));
    builtins.set('bar_index', fillSeries((i) => i));
    builtins.set('last_bar_index', fillSeries(() => n - 1));
    builtins.set('time', fillSeries((i) => bars[i].time * 1000));
    const tfSec = (typeof TF_SEC !== 'undefined' && typeof S !== 'undefined' && TF_SEC[S.tf]) || 0;
    builtins.set('time_close', fillSeries((i) => (bars[i].time + tfSec) * 1000));
    builtins.set('timenow', fillSeries(() => Date.now()));
    function dateOf(i) { return new Date(bars[i].time * 1000); }
    function datePart(name, date) {
      if (name === 'hour') return date.getUTCHours();
      if (name === 'minute') return date.getUTCMinutes();
      if (name === 'second') return date.getUTCSeconds();
      if (name === 'year') return date.getUTCFullYear();
      if (name === 'month') return date.getUTCMonth() + 1;
      if (name === 'dayofmonth') return date.getUTCDate();
      if (name === 'dayofweek') return date.getUTCDay() + 1;
      const start = Date.UTC(date.getUTCFullYear(), 0, 1);
      return Math.floor((date.getTime() - start) / 86400000 / 7) + 1;
    }
    for (const name of ['hour', 'minute', 'second', 'year', 'month', 'dayofmonth', 'dayofweek', 'weekofyear']) {
      builtins.set(name, fillSeries((i) => datePart(name, dateOf(i))));
    }

    function pushBuf(s, v) {
      if (!s.buf) s.buf = [];
      s.buf.push(asNum(v));
    }
    function taSma(key, src, len) {
      const s = mem(key); pushBuf(s, src);
      const w = Math.floor(Number(len));
      if (!Number.isFinite(w) || w < 1 || s.buf.length < w) return null;
      let sum = 0;
      for (let i = s.buf.length - w; i < s.buf.length; i++) { if (s.buf[i] == null) return null; sum += s.buf[i]; }
      return sum / w;
    }
    function smooth(key, src, len, alpha) {
      const s = mem(key); pushBuf(s, src);
      const w = Math.floor(Number(len));
      if (!Number.isFinite(w) || w < 1) return null;
      const v = s.buf[s.buf.length - 1];
      if (s.prev == null) {
        if (s.buf.length < w) return null;
        let sum = 0;
        for (let i = s.buf.length - w; i < s.buf.length; i++) { if (s.buf[i] == null) return null; sum += s.buf[i]; }
        s.prev = sum / w;
        return s.prev;
      }
      if (v == null) return null;
      const a = alpha(w);
      s.prev = a * v + (1 - a) * s.prev;
      return s.prev;
    }
    const taEma = (key, src, len) => smooth(key, src, len, (w) => 2 / (w + 1));
    const taRma = (key, src, len) => smooth(key, src, len, (w) => 1 / w);
    function taWma(key, src, len) {
      const s = mem(key); pushBuf(s, src);
      const w = Math.floor(Number(len));
      if (!Number.isFinite(w) || w < 1 || s.buf.length < w) return null;
      const den = w * (w + 1) / 2;
      let sum = 0;
      for (let k = 0; k < w; k++) {
        const v = s.buf[s.buf.length - 1 - k];
        if (v == null) return null;
        sum += v * (w - k);
      }
      return sum / den;
    }
    function taStdev(key, src, len) {
      const m = taSma(key + '/m', src, len);
      const s = mem(key); pushBuf(s, src);
      const w = Math.floor(Number(len));
      if (m == null || !Number.isFinite(w)) return null;
      let v = 0;
      for (let i = s.buf.length - w; i < s.buf.length; i++) v += (s.buf[i] - m) ** 2;
      return Math.sqrt(v / w);
    }
    function extreme(key, src, len, dir) {
      const s = mem(key); pushBuf(s, src);
      const w = Math.floor(Number(len));
      if (!Number.isFinite(w) || w < 1 || s.buf.length < w) return null;
      let m = dir > 0 ? -Infinity : Infinity, idx = 0, ok = true;
      for (let k = 0; k < w; k++) {
        const v = s.buf[s.buf.length - 1 - k];
        if (v == null) { ok = false; break; }
        if (dir > 0 ? v > m : v < m) { m = v; idx = k; }
      }
      return ok ? { m, bars: -idx } : null;
    }
    function taChange(key, src, len) {
      const s = mem(key); pushBuf(s, src);
      const w = Math.floor(Number(len) || 1);
      if (!Number.isFinite(w) || w < 1 || s.buf.length <= w) return null;
      const a = s.buf[s.buf.length - 1], b = s.buf[s.buf.length - 1 - w];
      if (a == null || b == null) return null;
      return a - b;
    }
    function taPivot(key, src, left, right, dir) {
      const s = mem(key); pushBuf(s, src);
      const L = Math.floor(Number(left)), R = Math.floor(Number(right));
      if (!Number.isFinite(L) || !Number.isFinite(R) || L < 1 || R < 1) return null;
      const c = s.buf.length - 1 - R;
      if (c < L) return null;
      const v = s.buf[c];
      if (v == null) return null;
      for (let k = c - L; k <= c + R; k++) {
        if (k === c) continue;
        const x = s.buf[k];
        if (x == null || (dir > 0 ? x >= v : x <= v)) return null;
      }
      return v;
    }
    function trAt(i) {
      const b = bars[i];
      if (!i) return b.high - b.low;
      const pc = bars[i - 1].close;
      return Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
    }

    function evalExpr(e) {
      if (!e) return null;
      switch (e.kind) {
        case 'num': return e.value;
        case 'str': return e.value;
        case 'bool': return e.value;
        case 'na': return null;
        case 'color': return { hex: e.hex, t: 0 };
        case 'array': return e.items.map(evalExpr);
        case 'id': return lookupValue(e.name, e.line);
        case 'unary': {
          const v = evalExpr(e.expr);
          if (e.op === 'not') return !truthy(v);
          const n = asNum(v);
          if (n == null) return null;
          return e.op === '-' ? -n : n;
        }
        case 'binary': return evalBinary(e);
        case 'ternary': return truthy(evalExpr(e.cond)) ? evalExpr(e.a) : evalExpr(e.b);
        case 'index': return evalIndex(e);
        case 'member': return evalMember(e);
        case 'call': return evalCall(e);
        case 'if': return truthy(evalExpr(e.cond)) ? evalBlock(e.then) : (e.else ? evalBlock(e.else) : null);
        case 'switch': return evalSwitch(e);
        default: return null;
      }
    }
    function lookupValue(name, line) {
      for (let i = loops.length - 1; i >= 0; i--) if (loops[i].has(name)) return loops[i].get(name);
      const s = lookupSeries(name);
      if (s) return readAt(s, bar);
      throw new PineError(`Không rõ "${name}"`, line);
    }
    function evalBinary(e) {
      if (e.op === 'and') { const l = evalExpr(e.l); return truthy(l) ? !!truthy(evalExpr(e.r)) : false; }
      if (e.op === 'or') { const l = evalExpr(e.l); return truthy(l) ? true : !!truthy(evalExpr(e.r)); }
      const l = evalExpr(e.l), r = evalExpr(e.r);
      if (e.op === '+' && (typeof l === 'string' || typeof r === 'string')) {
        if (l == null || r == null) return null;
        return String(l) + String(r);
      }
      if (e.op === '==') return eq(l, r);
      if (e.op === '!=') return ne(l, r);
      const a = asNum(l), b = asNum(r);
      if ('+-*/%'.includes(e.op)) {
        if (a == null || b == null) return null;
        if (e.op === '+') return a + b;
        if (e.op === '-') return a - b;
        if (e.op === '*') return a * b;
        if (e.op === '/') return b === 0 ? null : a / b;
        return b === 0 ? null : a % b;
      }
      if (a == null || b == null) return false;
      if (e.op === '>') return a > b;
      if (e.op === '<') return a < b;
      if (e.op === '>=') return a >= b;
      return a <= b;
    }
    function evalIndex(e) {
      const off = asNum(evalExpr(e.index));
      if (off == null || off < 0) return null;
      const o = Math.round(off);
      if (e.base.kind === 'id') {
        for (let i = loops.length - 1; i >= 0; i--) if (loops[i].has(e.base.name)) return o === 0 ? loops[i].get(e.base.name) : null;
        const s = lookupSeries(e.base.name);
        if (!s) throw new PineError(`Không rõ "${e.base.name}"`, e.line);
        return readAt(s, bar - o);
      }
      const cur = evalExpr(e.base);
      let h = hist.get(e.base.id);
      if (!h) { h = new Array(n); hist.set(e.base.id, h); }
      h[bar] = cur;
      const j = bar - o;
      return j < 0 || h[j] === undefined ? null : h[j];
    }
    function evalMember(e) {
      if (e.obj.kind !== 'id') throw new PineError('Chưa hỗ trợ .' + e.prop, e.line);
      const ns = e.obj.name, prop = e.prop;
      if (ns === 'color') {
        if (COLORS[prop]) return { hex: COLORS[prop], t: 0 };
        throw new PineError('Chưa hỗ trợ color.' + prop, e.line);
      }
      if (ns === 'dayofweek' && DAYS[prop]) return DAYS[prop];
      if (ns === 'barstate') {
        if (prop === 'isfirst') return bar === 0;
        if (prop === 'islast') return bar === n - 1;
        if (prop === 'isconfirmed' || prop === 'ishistory') return true;
        if (prop === 'isrealtime') return false;
        if (prop === 'isnew') return true;
      }
      if (ns === 'syminfo') {
        const sym = typeof S !== 'undefined' ? S : {};
        if (prop === 'ticker' || prop === 'tickerid') return sym.symbol || '';
        if (prop === 'mintick') return sym.pip || 0.0001;
        if (prop === 'pointvalue') return 1;
      }
      if (ns === 'timeframe') {
        const tf = typeof S !== 'undefined' ? (S.tf || '') : '';
        if (prop === 'period') return tf;
        if (prop === 'isintraday') return tf.startsWith('M') || tf.startsWith('H');
        if (prop === 'isdaily') return tf === 'D1';
        if (prop === 'isweekly') return tf === 'W1';
        if (prop === 'ismonthly') return false;
        if (prop === 'multiplier') { const m = /^[MHDW](\d+)$/.exec(tf); return m ? +m[1] : 1; }
      }
      return ns + '.' + prop;
    }
    function evalCall(e) {
      const name = calleeName(e.callee);
      const args = e.args.map((a) => ({ name: a.name, value: evalExpr(a.value) }));
      const key = siteKey(e);
      const user = lookupFunc(name);
      if (user) return callUser(user, args, key);
      return dispatch(name, args, key, e);
    }
    function callUser(fn, args, key) {
      let frame = frames.get(key);
      if (!frame) { frame = { key, series: new Map(), funcs: new Map() }; frames.set(key, frame); }
      const namedArgs = new Map(args.filter((a) => a.name).map((a) => [a.name, a.value]));
      const pos = args.filter((a) => !a.name).map((a) => a.value);
      let pi = 0;
      const bound = fn.params.map((p) => {
        if (namedArgs.has(p.name)) return namedArgs.get(p.name);
        if (pi < pos.length) return pos[pi++];
        return p.def ? evalExpr(p.def) : null;
      });
      stack.push(frame);
      try {
        fn.params.forEach((p, i) => {
          const s = define(p.name, false);
          s.values[bar] = bound[i];
          s.set[bar] = 1;
        });
        return evalBlock(fn.body);
      } finally { stack.pop(); }
    }
    function dispatch(name, args, key, e) {
      const a0 = args[0] ? args[0].value : null;
      const a1 = args[1] ? args[1].value : null;
      const a2 = args[2] ? args[2].value : null;
      const a3 = args[3] ? args[3].value : null;
      if (name === 'plot') return doPlot(e, args);
      if (name === 'hline') return doHline(e, args);
      if (name === 'plotshape' || name === 'plotchar') return doShape(e, args, name);
      if (name === 'barcolor') return doBarColor(args);
      if (name === 'fill' || name === 'bgcolor' || name === 'alert' || name === 'alertcondition' || name === 'indicator' || name === 'study' || name === 'max_bars_back') return null;
      if (name === 'nz') return a0 == null ? (args[1] ? a1 : 0) : a0;
      if (name === 'na') return a0 == null;
      if (name === 'fixnan') { const s = mem(key); if (a0 != null) s.last = a0; return a0 != null ? a0 : (s.last == null ? null : s.last); }
      if (name === 'input' || name.startsWith('input.')) return readInput(e);
      if (name === 'ta.sma') return taSma(key, a0, a1);
      if (name === 'ta.ema') return taEma(key, a0, a1);
      if (name === 'ta.rma') return taRma(key, a0, a1);
      if (name === 'ta.wma') return taWma(key, a0, a1);
      if (name === 'ta.vwma') return taVwma(key, a0, a1);
      if (name === 'ta.swma') return taSwma(key, a0);
      if (name === 'ta.hma') return taHma(key, a0, a1);
      if (name === 'ta.stdev') return taStdev(key, a0, a1);
      if (name === 'ta.highest') { const x = extreme(key, a0, a1, 1); return x && x.m; }
      if (name === 'ta.lowest') { const x = extreme(key, a0, a1, -1); return x && x.m; }
      if (name === 'ta.highestbars') { const x = extreme(key, a0, a1, 1); return x ? x.bars : null; }
      if (name === 'ta.lowestbars') { const x = extreme(key, a0, a1, -1); return x ? x.bars : null; }
      if (name === 'ta.change' || name === 'ta.mom') return taChange(key, a0, args[1] ? a1 : 1);
      if (name === 'ta.roc') { const ch = taChange(key, a0, a1); const s = mem(key + '/b'); return ch == null || s.prev == null || s.prev === 0 ? null : ch / s.prev * 100; }
      if (name === 'ta.tr') return trAt(bar);
      if (name === 'ta.atr') return taRma(key, trAt(bar), a0);
      if (name === 'ta.rsi') return taRsi(key, a0, a1);
      if (name === 'ta.cum') return taCum(key, a0);
      if (name === 'ta.crossover') return taCross(key, a0, a1, 'over');
      if (name === 'ta.crossunder') return taCross(key, a0, a1, 'under');
      if (name === 'ta.cross') return taCross(key, a0, a1, 'both');
      if (name === 'ta.pivothigh') return taPivot(key, a0, a1, a2, 1);
      if (name === 'ta.pivotlow') return taPivot(key, a0, a1, a2, -1);
      if (name === 'ta.valuewhen') return taValueWhen(key, a0, a1, a2);
      if (name === 'ta.barssince') return taBarsSince(key, a0);
      if (name === 'ta.rising') return taCmp(key, a0, a1, '>');
      if (name === 'ta.falling') return taCmp(key, a0, a1, '<');
      if (name === 'ta.bb') return taBb(key, a0, a1, a2);
      if (name === 'ta.macd') return taMacd(key, a0, a1, a2, a3);
      if (name === 'ta.stoch') return taStoch(key, a0, a1, a2, a3);
      if (name === 'ta.cci') return taCci(key, a0, a1);
      if (name === 'ta.linreg') return taLinreg(key, a0, a1, a2);
      if (name === 'ta.range') { const hi = extreme(key + '/h', a0, a1, 1), lo = extreme(key + '/l', a0, a1, -1); return hi && lo ? hi.m - lo.m : null; }
      if (name.startsWith('math.')) return mathCall(name.slice(5), args);
      if (name.startsWith('color.')) return colorCall(name.slice(6), args);
      if (name.startsWith('array.')) return arrayCall(name.slice(6), args);
      if (name.startsWith('line.')) return lineCall(name, args);
      if (name.startsWith('label.')) return labelCall(name, args);
      if (name.startsWith('str.')) return strCall(name.slice(4), args);
      if (name === 'hour' || name === 'minute' || name === 'second' || name === 'year' || name === 'month' || name === 'dayofmonth' || name === 'dayofweek' || name === 'weekofyear') {
        const t = args.length ? asNum(a0) : null;
        const date = t == null ? dateOf(bar) : new Date(t > 1e11 ? t : t * 1000);
        return datePart(name, date);
      }
      if (name === 'timestamp') {
        const y = asNum(a0), m = asNum(a1), d = asNum(a2);
        if (y == null) return null;
        return Date.UTC(y, (m || 1) - 1, d || 1, asNum(args[3] && args[3].value) || 0, asNum(args[4] && args[4].value) || 0, asNum(args[5] && args[5].value) || 0);
      }
      if (name === 'int') { const v = asNum(a0); return v == null ? null : Math.trunc(v); }
      if (name === 'float') return asNum(a0);
      if (name === 'bool') return truthy(a0);
      if (name === 'runtime.error') throw new PineError(String(a0 == null ? 'runtime.error' : a0), e.line);
      if (name === 'runtime.log' || name.startsWith('log.')) return null;
      throw new PineError(`Chưa hỗ trợ "${name}"`, e.line);
    }
    function taVwma(key, src, len) {
      const s = mem(key);
      if (!s.pv) { s.pv = []; s.vv = []; }
      const v = asNum(src);
      s.pv.push(v);
      s.vv.push(v == null ? null : 1);
      const w = Math.floor(Number(len));
      if (!Number.isFinite(w) || w < 1 || s.pv.length < w) return null;
      let ps = 0;
      for (let i = s.pv.length - w; i < s.pv.length; i++) { if (s.pv[i] == null) return null; ps += s.pv[i]; }
      return ps / w;
    }
    function taSwma(key, src) {
      const s = mem(key); pushBuf(s, src);
      if (s.buf.length < 4) return null;
      const b = s.buf, i = b.length - 1;
      if (b[i] == null || b[i - 1] == null || b[i - 2] == null || b[i - 3] == null) return null;
      return (b[i - 3] + 2 * b[i - 2] + 2 * b[i - 1] + b[i]) / 6;
    }
    function taHma(key, src, len) {
      const w = Math.max(1, Math.floor(Number(len) || 1));
      const half = Math.max(1, Math.floor(w / 2));
      const a = taWma(key + '/a', src, half);
      const b = taWma(key + '/b', src, w);
      return taWma(key + '/c', a == null || b == null ? null : 2 * a - b, Math.max(1, Math.round(Math.sqrt(w))));
    }
    function taRsi(key, src, len) {
      const ch = taChange(key + '/c', src, 1);
      const up = ch == null ? null : Math.max(ch, 0);
      const dn = ch == null ? null : Math.max(-ch, 0);
      const u = taRma(key + '/u', up, len);
      const d = taRma(key + '/d', dn, len);
      if (u == null || d == null) return null;
      if (d === 0) return 100;
      return 100 - 100 / (1 + u / d);
    }
    function taCum(key, src) {
      const s = mem(key);
      const v = asNum(src);
      if (v == null) return s.sum == null ? null : s.sum;
      s.sum = (s.sum || 0) + v;
      return s.sum;
    }
    function taCross(key, a, b, dir) {
      const s = mem(key);
      const pa = s.a, pb = s.b;
      s.a = asNum(a); s.b = asNum(b);
      if (s.a == null || s.b == null || pa == null || pb == null) return false;
      const over = pa <= pb && s.a > s.b;
      const under = pa >= pb && s.a < s.b;
      return dir === 'over' ? over : dir === 'under' ? under : (over || under);
    }
    function taValueWhen(key, cond, src, occ) {
      const s = mem(key);
      if (!s.hits) s.hits = [];
      if (truthy(cond)) s.hits.push(src);
      const o = Math.floor(asNum(occ) || 0);
      const i = s.hits.length - 1 - (Number.isFinite(o) ? o : 0);
      return i >= 0 ? s.hits[i] : null;
    }
    function taBarsSince(key, cond) {
      const s = mem(key);
      if (truthy(cond)) s.last = bar;
      return s.last == null ? null : bar - s.last;
    }
    function taCmp(key, src, len, op) {
      const s = mem(key); pushBuf(s, src);
      const w = Math.floor(Number(len) || 1);
      if (s.buf.length <= w) return false;
      const a = s.buf[s.buf.length - 1], b = s.buf[s.buf.length - 1 - w];
      if (a == null || b == null) return false;
      return op === '>' ? a > b : a < b;
    }
    function taBb(key, src, len, mult) {
      const mid = taSma(key + '/m', src, len);
      const sd = taStdev(key + '/d', src, len);
      const m = asNum(mult) == null ? 2 : asNum(mult);
      if (mid == null || sd == null) return [null, null, null];
      return [mid, mid + sd * m, mid - sd * m];
    }
    function taMacd(key, src, fast, slow, sig) {
      const a = taEma(key + '/f', src, fast == null ? 12 : fast);
      const b = taEma(key + '/s', src, slow == null ? 26 : slow);
      const m = a == null || b == null ? null : a - b;
      const g = taEma(key + '/g', m, sig == null ? 9 : sig);
      return [m, g, m == null || g == null ? null : m - g];
    }
    function taStoch(key, src, high, low, len) {
      const hh = extreme(key + '/h', high, len, 1);
      const ll = extreme(key + '/l', low, len, -1);
      const v = asNum(src);
      if (!hh || !ll || v == null || hh.m === ll.m) return null;
      return 100 * (v - ll.m) / (hh.m - ll.m);
    }
    function taCci(key, src, len) {
      const m = taSma(key + '/m', src, len);
      const s = mem(key); pushBuf(s, src);
      const w = Math.floor(Number(len));
      if (m == null || !Number.isFinite(w) || s.buf.length < w) return null;
      let dev = 0;
      for (let i = s.buf.length - w; i < s.buf.length; i++) { if (s.buf[i] == null) return null; dev += Math.abs(s.buf[i] - m); }
      dev /= w;
      const v = s.buf[s.buf.length - 1];
      return dev === 0 || v == null ? 0 : (v - m) / (0.015 * dev);
    }
    function taLinreg(key, src, len, offset) {
      const s = mem(key); pushBuf(s, src);
      const w = Math.floor(Number(len));
      if (!Number.isFinite(w) || w < 2 || s.buf.length < w) return null;
      let sx = 0, sy = 0, sxy = 0, sx2 = 0;
      for (let k = 0; k < w; k++) {
        const v = s.buf[s.buf.length - w + k];
        if (v == null) return null;
        sx += k; sy += v; sxy += k * v; sx2 += k * k;
      }
      const den = w * sx2 - sx * sx;
      if (!den) return sy / w;
      const slope = (w * sxy - sx * sy) / den;
      const intercept = (sy - slope * sx) / w;
      const off = Math.floor(asNum(offset) || 0);
      return intercept + slope * (w - 1 - off);
    }
    function mathCall(op, args) {
      const nums = args.map((a) => asNum(a.value));
      if (op === 'abs' || op === 'floor' || op === 'ceil' || op === 'sqrt' || op === 'log' || op === 'log10' || op === 'exp' || op === 'sign') {
        const v = nums[0];
        if (v == null) return null;
        if (op === 'abs') return Math.abs(v);
        if (op === 'floor') return Math.floor(v);
        if (op === 'ceil') return Math.ceil(v);
        if (op === 'sqrt') return v < 0 ? null : Math.sqrt(v);
        if (op === 'log') return v <= 0 ? null : Math.log(v);
        if (op === 'log10') return v <= 0 ? null : Math.log10(v);
        if (op === 'exp') return Math.exp(v);
        return Math.sign(v);
      }
      if (op === 'round') {
        const v = nums[0];
        if (v == null) return null;
        const p = nums[1] == null ? 0 : Math.trunc(nums[1]);
        const f = 10 ** p;
        return Math.round(v * f) / f;
      }
      if (op === 'pow') return nums[0] == null || nums[1] == null ? null : nums[0] ** nums[1];
      if (op === 'max' || op === 'min') {
        if (nums.some((v) => v == null)) return null;
        return op === 'max' ? Math.max(...nums) : Math.min(...nums);
      }
      if (op === 'avg') {
        if (!nums.length || nums.some((v) => v == null)) return null;
        return nums.reduce((s, v) => s + v, 0) / nums.length;
      }
      return null;
    }
    function colorCall(op, args) {
      if (op === 'new') {
        const base = asColor(args[0] && args[0].value);
        const t = asNum(args[1] && args[1].value) || 0;
        if (!base) return null;
        return { hex: base.hex, t: Math.max(0, Math.min(100, t)) };
      }
      if (op === 'rgb') {
        const r = asNum(args[0] && args[0].value), g = asNum(args[1] && args[1].value), b = asNum(args[2] && args[2].value);
        if (r == null || g == null || b == null) return null;
        const t = asNum(args[3] && args[3].value) || 0;
        return { hex: hexOf(r, g, b), t: Math.max(0, Math.min(100, t)) };
      }
      if (op === 'from_gradient') {
        const v = asNum(args[0] && args[0].value), lo = asNum(args[1] && args[1].value), hi = asNum(args[2] && args[2].value);
        const c1 = asColor(args[3] && args[3].value), c2 = asColor(args[4] && args[4].value);
        if (v == null || lo == null || hi == null || !c1 || !c2) return null;
        const t = hi === lo ? 0 : Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
        const A = rgbOf(c1.hex), B = rgbOf(c2.hex);
        return { hex: hexOf(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t), t: Math.round(c1.t + (c2.t - c1.t) * t) };
      }
      if (op === 'r' || op === 'g' || op === 'b') {
        const c = asColor(args[0] && args[0].value);
        if (!c) return null;
        const rgb = rgbOf(c.hex);
        return op === 'r' ? rgb[0] : op === 'g' ? rgb[1] : rgb[2];
      }
      throw new PineError('Chưa hỗ trợ color.' + op);
    }
    function freshArray(size, init) {
      const a = [];
      const len = Math.max(0, Math.floor(asNum(size) || 0));
      for (let i = 0; i < len; i++) a.push(init == null ? null : init);
      return a;
    }
    function arrayCall(op, args) {
      const id = args[0] ? args[0].value : null;
      if (op.startsWith('new_')) return freshArray(args[0] && args[0].value, args[1] ? args[1].value : null);
      if (!Array.isArray(id)) return op === 'size' ? 0 : null;
      const ix = args[1] ? Math.floor(asNum(args[1].value) || 0) : 0;
      if (op === 'get') return ix >= 0 && ix < id.length ? id[ix] : null;
      if (op === 'set') { if (ix >= 0 && ix < id.length) id[ix] = args[2] ? args[2].value : null; return null; }
      if (op === 'push') { id.push(args[1] ? args[1].value : null); return null; }
      if (op === 'pop') return id.length ? id.pop() : null;
      if (op === 'shift') return id.length ? id.shift() : null;
      if (op === 'unshift') { id.unshift(args[1] ? args[1].value : null); return null; }
      if (op === 'size') return id.length;
      if (op === 'clear') { id.length = 0; return null; }
      if (op === 'last') return id.length ? id[id.length - 1] : null;
      if (op === 'first') return id.length ? id[0] : null;
      if (op === 'includes') return id.includes(args[1] ? args[1].value : null);
      if (op === 'remove') return ix >= 0 && ix < id.length ? id.splice(ix, 1)[0] : null;
      if (op === 'insert') { if (ix >= 0 && ix <= id.length) id.splice(ix, 0, args[2] ? args[2].value : null); return null; }
      if (op === 'copy') return id.slice();
      if (op === 'concat') return id.concat(Array.isArray(args[1] && args[1].value) ? args[1].value : []);
      if (op === 'slice') return id.slice(ix, args[2] ? Math.floor(asNum(args[2].value) || 0) : undefined);
      if (op === 'fill') { id.fill(args[1] ? args[1].value : null); return null; }
      return null;
    }
    function delObj(v) {
      if (v == null) return;
      if (Array.isArray(v)) { v.forEach(delObj); return; }
      if (typeof v === 'object') v.dead = true;
    }
    function lineCall(name, args) {
      if (name === 'line.new') {
        const obj = {
          x1: asNum(argAt(args, 'x1', 0)), y1: asNum(argAt(args, 'y1', 1)),
          x2: asNum(argAt(args, 'x2', 2)), y2: asNum(argAt(args, 'y2', 3)),
          color: cssColor(argAt(args, 'color', 6)) || '#2962ff',
          style: String(argAt(args, 'style', 7) || ''),
          width: asNum(argAt(args, 'width', 8)) || 1,
          dead: false,
        };
        lines.push(obj);
        return obj;
      }
      if (name === 'line.delete') { delObj(args[0] && args[0].value); return null; }
      const obj = args[0] && args[0].value;
      if (!obj) return null;
      if (name === 'line.get_x1') return obj.x1;
      if (name === 'line.get_y1') return obj.y1;
      if (name === 'line.get_x2') return obj.x2;
      if (name === 'line.get_y2') return obj.y2;
      if (name === 'line.set_xy1') { obj.x1 = asNum(args[1] && args[1].value); obj.y1 = asNum(args[2] && args[2].value); }
      else if (name === 'line.set_xy2') { obj.x2 = asNum(args[1] && args[1].value); obj.y2 = asNum(args[2] && args[2].value); }
      else if (name === 'line.set_x1') obj.x1 = asNum(args[1] && args[1].value);
      else if (name === 'line.set_y1') obj.y1 = asNum(args[1] && args[1].value);
      else if (name === 'line.set_x2') obj.x2 = asNum(args[1] && args[1].value);
      else if (name === 'line.set_y2') obj.y2 = asNum(args[1] && args[1].value);
      else if (name === 'line.set_color') { const c = cssColor(args[1] && args[1].value); if (c) obj.color = c; }
      else if (name === 'line.set_width') obj.width = asNum(args[1] && args[1].value) || 1;
      else if (name === 'line.set_style') obj.style = String((args[1] && args[1].value) || '');
      return null;
    }
    function labelCall(name, args) {
      if (name === 'label.new') {
        const obj = {
          x: asNum(argAt(args, 'x', 0)), y: asNum(argAt(args, 'y', 1)),
          text: argAt(args, 'text', 2) == null ? '' : String(argAt(args, 'text', 2)),
          color: cssColor(argAt(args, 'color', 5)) || '#2962ff',
          textColor: cssColor(argAt(args, 'textcolor', 7)) || '#ffffff',
          style: String(argAt(args, 'style', 6) || ''),
          dead: false,
        };
        labels.push(obj);
        return obj;
      }
      if (name === 'label.delete') { delObj(args[0] && args[0].value); return null; }
      const obj = args[0] && args[0].value;
      if (!obj) return null;
      if (name === 'label.get_x') return obj.x;
      if (name === 'label.get_y') return obj.y;
      if (name === 'label.get_text') return obj.text;
      if (name === 'label.set_text') obj.text = args[1] && args[1].value == null ? '' : String(args[1].value);
      else if (name === 'label.set_xy') { obj.x = asNum(args[1] && args[1].value); obj.y = asNum(args[2] && args[2].value); }
      else if (name === 'label.set_x') obj.x = asNum(args[1] && args[1].value);
      else if (name === 'label.set_y') obj.y = asNum(args[1] && args[1].value);
      else if (name === 'label.set_color') { const c = cssColor(args[1] && args[1].value); if (c) obj.color = c; }
      else if (name === 'label.set_textcolor') { const c = cssColor(args[1] && args[1].value); if (c) obj.textColor = c; }
      else if (name === 'label.set_style') obj.style = String((args[1] && args[1].value) || '');
      return null;
    }
    function toStr(v) {
      if (v == null) return 'NaN';
      if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 1e8) / 1e8) : 'NaN';
      if (typeof v === 'boolean') return v ? 'true' : 'false';
      return String(v);
    }
    function strCall(op, args) {
      const s = args[0] && args[0].value != null ? String(args[0].value) : '';
      const b = args[1] && args[1].value != null ? String(args[1].value) : '';
      if (op === 'tostring') return toStr(args[0] && args[0].value);
      if (op === 'format') {
        const rest = args.slice(1).map((a) => a.value);
        return s.replace(/\{(\d+)\}/g, (_, i) => toStr(rest[+i]));
      }
      if (op === 'length') return args[0] && args[0].value == null ? 0 : s.length;
      if (op === 'contains') return s.indexOf(b) >= 0;
      if (op === 'startswith') return s.startsWith(b);
      if (op === 'endswith') return s.endsWith(b);
      if (op === 'lower') return args[0] && args[0].value == null ? null : s.toLowerCase();
      if (op === 'upper') return args[0] && args[0].value == null ? null : s.toUpperCase();
      if (op === 'replace') return s.split(b).join(args[2] && args[2].value != null ? String(args[2].value) : '');
      if (op === 'split') return s.split(b);
      return null;
    }
    function readInput(e) {
      const prm = meta.params.find((p) => p.id === e.paramId);
      if (!prm) throw new PineError('input() phải nằm ngoài hàm', e.line);
      let v = params[prm.id];
      if (v === undefined) v = prm.default;
      if (prm.type === 'source') {
        const which = typeof v === 'string' && SRC.has(v) ? v : 'close';
        return readAt(builtins.get(which), bar);
      }
      if (prm.type === 'bool') return !!v;
      if (prm.type === 'number') { const n = asNum(typeof v === 'string' ? parseFloat(v) : v); return n == null ? prm.default : n; }
      if (prm.type === 'color') return asColor(v) || { hex: '#2962ff', t: 0 };
      return v;
    }
    function putPlot(id, value, offset, color, hide) {
      if (!id || hide) return value;
      const dest = bar + (Number.isFinite(offset) ? offset : 0);
      if (dest < 0 || dest >= n) return value;
      if (hide === 'gap' || value == null || !Number.isFinite(value)) out[id][dest] = null;
      else {
        out[id][dest] = value;
        if (color) { colorOf[id][dest] = color; usedColor = true; }
      }
      return value;
    }
    function doPlot(e, args) {
      const value = asNum(argAt(args, null, 0));
      const offset = Math.round(asNum(argAt(args, 'offset', 7)) || 0);
      const raw = hasArg(args, 'color', 2) ? argAt(args, 'color', 2) : undefined;
      const col = raw === undefined ? undefined : cssColor(raw);
      return putPlot(e.plotId, value, offset, col && col !== null ? col : null, e.hidden || col === null ? 'gap' : false);
    }
    function doHline(e, args) {
      const value = asNum(argAt(args, 'price', 0));
      const raw = hasArg(args, 'color', 2) ? argAt(args, 'color', 2) : undefined;
      const col = raw === undefined ? undefined : cssColor(raw);
      putPlot(e.plotId, value, 0, typeof col === 'string' ? col : null, e.hidden || col === null ? 'gap' : false);
      return value;
    }
    function doShape(e, args, kind) {
      const series = argAt(args, 'series', 0);
      if (series == null || series === false) return series;
      const offset = Math.round(asNum(argAt(args, 'offset', 5)) || 0);
      const dest = bar + offset;
      if (dest < 0 || dest >= n) return series;
      const style = String(argAt(args, 'style', kind === 'plotchar' ? 2 : 2) || '');
      const loc = String(argAt(args, 'location', 3) || '');
      const raw = argAt(args, 'color', 4);
      const col = cssColor(raw);
      if (col === null) return series;
      let shape = 'circle', position = 'inBar';
      if (/down/.test(style)) shape = 'arrowDown';
      else if (/up/.test(style)) shape = 'arrowUp';
      else if (/square|diamond|label/.test(style)) shape = 'square';
      if (/below|bottom/.test(loc)) position = 'belowBar';
      else if (/above|top/.test(loc)) position = 'aboveBar';
      const text = argAt(args, kind === 'plotchar' ? 'char' : 'text', kind === 'plotchar' ? 2 : 6);
      marks.push({ time: bars[dest].time, position, color: col || '#2962ff', shape, text: text == null ? '' : String(text) });
      return series;
    }
    function doBarColor(args) {
      if (!barColor) barColor = new Array(n).fill(null);
      const off = Math.round(asNum(argAt(args, 'offset', 1)) || 0);
      const dest = bar + off;
      const col = cssColor(args[0] && args[0].value);
      if (dest >= 0 && dest < n) barColor[dest] = col || null;
      return null;
    }
    function evalSwitch(e) {
      if (e.expr != null) {
        const v = evalExpr(e.expr);
        for (const arm of e.arms) {
          if (!arm.cond || eq(evalExpr(arm.cond), v)) return evalBlock(arm.body);
        }
        return null;
      }
      for (const arm of e.arms) {
        if (!arm.cond || truthy(evalExpr(arm.cond))) return evalBlock(arm.body);
      }
      return null;
    }
    function evalBlock(stmts) {
      const frame = stack[stack.length - 1];
      for (const s of stmts) if (s.kind === 'func') frame.funcs.set(s.name, s);
      let v = null;
      for (const s of stmts) if (s.kind !== 'func') v = evalStmt(s);
      return v;
    }
    function evalStmt(s) {
      try {
        if (s.kind === 'break') throw { ctrl: 'br' };
        if (s.kind === 'continue') throw { ctrl: 'co' };
        if (s.kind === 'assign') return evalAssign(s);
        if (s.kind === 'tuple') return evalTuple(s);
        if (s.kind === 'if' || s.kind === 'switch') return evalExpr(s);
        if (s.kind === 'for') return evalFor(s);
        if (s.kind === 'while') return evalWhile(s);
        if (s.kind === 'expr') return evalExpr(s.expr);
        return null;
      } catch (err) {
        if (err && err.ctrl) throw err;
        if (err instanceof PineError) throw err;
        throw new PineError(err.message || String(err), s.line);
      }
    }
    function evalAssign(s) {
      if (s.isVar && s.op === '=') {
        const series = define(s.name, true);
        if (!series.inited) {
          series.inited = true;
          const v = evalExpr(s.expr);
          series.values[bar] = v;
          series.set[bar] = 1;
        }
        return readAt(series, bar);
      }
      if (s.op === ':=') {
        const series = lookupSeries(s.name) || define(s.name, false);
        const v = evalExpr(s.expr);
        series.values[bar] = v;
        series.set[bar] = 1;
        return v;
      }
      const series = define(s.name, false);
      const v = evalExpr(s.expr);
      series.values[bar] = v;
      series.set[bar] = 1;
      return v;
    }
    function evalTuple(s) {
      const arr = evalExpr(s.expr);
      if (!Array.isArray(arr)) throw new PineError('Biểu thức này không trả về nhiều giá trị', s.line);
      s.names.forEach((name, i) => {
        const series = s.op === ':=' ? (lookupSeries(name) || define(name, false)) : define(name, s.isVar);
        series.values[bar] = arr[i] == null ? null : arr[i];
        series.set[bar] = 1;
      });
      return arr[0];
    }
    function loopBody(body) {
      try { return evalBlock(body); }
      catch (err) {
        if (err && err.ctrl === 'br') return { stop: true };
        if (err && err.ctrl === 'co') return { skip: true };
        throw err;
      }
    }
    function evalFor(s) {
      const from = asNum(evalExpr(s.from)), to = asNum(evalExpr(s.to));
      const step = s.by ? asNum(evalExpr(s.by)) : 1;
      if (from == null || to == null || step == null || step === 0) return null;
      const scope = new Map();
      loops.push(scope);
      let last = null, steps = 0;
      try {
        if (step > 0) {
          for (let i = from; i <= to + 1e-9; i += step) {
            if (++steps > 100000) throw new PineError('Vòng lặp quá dài', s.line);
            scope.set(s.name, i);
            const r = loopBody(s.body);
            if (!r || r.skip) continue;
            if (r.stop) break;
            last = r;
          }
        } else {
          for (let i = from; i >= to - 1e-9; i += step) {
            if (++steps > 100000) throw new PineError('Vòng lặp quá dài', s.line);
            scope.set(s.name, i);
            const r = loopBody(s.body);
            if (!r || r.skip) continue;
            if (r.stop) break;
            last = r;
          }
        }
      } finally { loops.pop(); }
      return last;
    }
    function evalWhile(s) {
      let last = null, steps = 0;
      while (truthy(evalExpr(s.cond))) {
        if (++steps > 100000) throw new PineError('Vòng lặp quá dài', s.line);
        const r = loopBody(s.body);
        if (!r || r.skip) continue;
        if (r.stop) break;
        last = r;
      }
      return last;
    }

    for (bar = 0; bar < n; bar++) {
      counts.clear();
      if (bar > 0) {
        for (const s of varList) {
          s.values[bar] = s.values[bar - 1];
          s.set[bar] = s.set[bar - 1];
        }
      }
      evalBlock(ast);
    }
    const alive = (arr) => arr.filter((x) => x && !x.dead).slice(-3000);
    const res = { marks, lines: alive(lines), labels: alive(labels) };
    for (const pl of meta.plots) res[pl.id] = out[pl.id];
    if (usedColor) res.colors = colorOf;
    if (barColor) res.barColor = barColor;
    return res;
  }

  return { looksLike, compile };
})();
window.Pine = Pine;
