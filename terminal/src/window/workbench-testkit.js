// How the workbench's Tests view finds, runs and reads tests (27 Nov 2026, workbench-tests.js), with nothing of a disk in
// it, so the window's server (workbench-run.mjs) and hearth's page (whose folders are on another machine) read tests the
// same way: which runner from a folder's files, a test file's tests by name and line, the command for a run, and what
// the run printed as each test's result and its totals. As a plain script it sets globalThis.WorkbenchTestKit.
(() => {
  function runnerFrom({ has, pkg }) {
    const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
    if (deps.vitest) return 'vitest';
    if (deps.jest) return 'jest';
    if (has('bun.lock') || has('bun.lockb') || has('bunfig.toml')) return 'bun';
    if (has('go.mod')) return 'go';
    if (has('pytest.ini') || has('pyproject.toml') || has('setup.cfg') || has('tox.ini') || has('conftest.py')) return 'pytest';
    if (pkg) return 'node';
    return null;
  }
  const TEST_FILE = { js: /(^|\/)(__tests__\/.*\.(m?[jt]sx?|c[jt]s)|[^/]+\.(test|spec)\.(m?[jt]sx?|c[jt]s))$/i, py: /(^|\/)(test_[^/]*|[^/]*_test)\.py$/, go: /_test\.go$/ };
  const kindOf = (runner) => (runner === 'pytest' ? 'py' : runner === 'go' ? 'go' : 'js');
  // A test file's tests by name and line: test( / it( in JavaScript (a describe's name in front, as runners print it),
  // def test_ in Python, func Test in Go. Read from the text, not by running anything.
  function testsIn(text, kind) {
    const out = []; const lines = String(text).split('\n');
    if (kind === 'js') {
      const stack = []; let depth = 0;
      lines.forEach((l, i) => {
        const d = /^\s*describe(?:\.\w+)*(?:\([^)]*\))?\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/.exec(l);
        const t = /^\s*(?:test|it)(?:\.(?:skip|only|todo|failing|concurrent|serial))*(?:\.(?:skipIf|if|each|runIf)\([^)]*\))?\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/.exec(l);
        while (stack.length && depth <= stack.at(-1).depth) stack.pop();
        const un = (x) => x.replace(/\\(.)/g, '$1');
        if (d) stack.push({ name: un(d[2]), depth });
        if (t) out.push({ name: [...stack.map((s) => s.name), un(t[2])].join(' > '), short: un(t[2]), line: i + 1 });
        for (const c of l.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '')) { if (c === '{') depth++; else if (c === '}') depth--; }
      });
    } else if (kind === 'py') {
      let cls = null;
      lines.forEach((l, i) => {
        const c = /^class\s+(Test\w*)/.exec(l); if (c) cls = c[1]; else if (/^\S/.test(l)) cls = null;
        const f = /^(\s*)(?:async\s+)?def\s+(test\w*)\s*\(/.exec(l);
        if (f && (!f[1] || cls)) out.push({ name: f[1] && cls ? `${cls}::${f[2]}` : f[2], short: f[2], line: i + 1 });
      });
    } else {
      lines.forEach((l, i) => { const f = /^func\s+(Test\w+)\s*\(/.exec(l); if (f) out.push({ name: f[1], short: f[1], line: i + 1 }); });
    }
    return out;
  }
  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // The command for a run: everything, one file, or one test of a file.
  function testCommand(runner, pkg, { path = null, name = null } = {}) {
    const file = path ? `./${path}` : null;
    if (runner === 'bun') return !file ? (pkg?.scripts?.test ? ['bun', 'run', 'test'] : ['bun', 'test']) : ['bun', 'test', file, ...(name ? ['-t', `^${esc(name)}$`] : [])];
    if (runner === 'vitest') return ['npx', 'vitest', 'run', '--reporter=verbose', ...(file ? [file] : []), ...(name ? ['-t', name.split(' > ').pop()] : [])];
    if (runner === 'jest') return ['npx', 'jest', '--verbose', ...(file ? [file] : []), ...(name ? ['-t', name.split(' > ').pop()] : [])];
    if (runner === 'node') return ['node', '--test', '--test-reporter=spec', ...(name ? [`--test-name-pattern=^${esc(name.split(' > ').pop())}$`] : []), ...(file ? [file] : [])];
    if (runner === 'pytest') return ['python3', '-m', 'pytest', '-rA', '-q', ...(file ? [name ? `${path}::${name}` : path] : [])];
    if (runner === 'go') return ['go', 'test', '-v', ...(name ? ['-run', `^${name}$`] : []), path ? `./${path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.'}` : './...'];
    return null;
  }
  // What a run printed → each test's result: { name, state: pass | fail | skip, ms }
  const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
  function resultsOf(text, runner) {
    const out = [];
    for (const raw of String(text).replace(ANSI, '').split('\n')) {
      const l = raw.trimEnd(); let m;
      if (runner === 'bun' && (m = /^\((pass|fail|skip|todo)\)\s+(.+?)(?:\s+\[([\d.]+)ms\])?$/.exec(l))) out.push({ name: m[2], state: m[1] === 'todo' ? 'skip' : m[1], ms: m[3] ? Number(m[3]) : null });
      else if ((runner === 'vitest' || runner === 'jest' || runner === 'node') && (m = /^\s*(✓|√|✔|×|✕|✗|✖|↓|○)\s+(.+?)(?:\s+\(?([\d.]+)\s*m?s\)?)?$/.exec(l))) out.push({ name: m[2].replace(/^.*?\.(?:test|spec)\.[cm]?[jt]sx? > /, ''), state: /[✓√✔]/.test(m[1]) ? 'pass' : /[↓○]/.test(m[1]) ? 'skip' : 'fail', ms: m[3] ? Number(m[3]) : null });
      else if (runner === 'pytest' && (m = /^(PASSED|FAILED|ERROR|SKIPPED|XFAIL|XPASS)\s+(\S+?)(?:\s+-\s+.*)?$/.exec(l))) out.push({ name: m[2].split('::').slice(1).join('::') || m[2], file: m[2].split('::')[0], state: m[1] === 'PASSED' || m[1] === 'XPASS' ? 'pass' : m[1] === 'SKIPPED' || m[1] === 'XFAIL' ? 'skip' : 'fail', ms: null });
      else if (runner === 'go' && (m = /^\s*--- (PASS|FAIL|SKIP): (\S+) \(([\d.]+)s\)/.exec(l))) out.push({ name: m[2], state: m[1].toLowerCase(), ms: Number(m[3]) * 1000 });
    }
    return out;
  }
  // The run's own totals line: { pass, fail, skip } or null. Bun out of a terminal names only the tests that failed, so
  // the tests it does not name passed when these add up to the tests the run covered (workbench-tests.js).
  function countsOf(text, runner) {
    const t = String(text).replace(ANSI, '');
    const n = (re) => { const m = re.exec(t); return m ? Number(m[1]) : 0; };
    const any = (...res) => res.some((re) => re.test(t));
    if (runner === 'bun' && any(/^\s*\d+ (pass|fail)\b/m)) return { pass: n(/^\s*(\d+) pass\b/m), fail: n(/^\s*(\d+) fail\b/m), skip: n(/^\s*(\d+) (?:skip|todo)\b/m) };
    const of = (line, w) => Number((new RegExp(`(\\d+) ${w}`).exec(line) ?? [0, 0])[1]);
    if (runner === 'vitest' && any(/^\s*Tests\s+\d/m)) { const l = /^\s*Tests\s+(.*)$/m.exec(t)[1]; return { pass: of(l, 'passed'), fail: of(l, 'failed'), skip: of(l, 'skipped') }; }
    if (runner === 'jest' && any(/^Tests:/m)) { const l = /^Tests:(.*)$/m.exec(t)[1]; return { pass: of(l, 'passed'), fail: of(l, 'failed'), skip: of(l, 'skipped') }; }
    if (runner === 'node' && any(/^ℹ pass \d+/m)) return { pass: n(/^ℹ pass (\d+)/m), fail: n(/^ℹ fail (\d+)/m), skip: n(/^ℹ skipped (\d+)/m) };
    if (runner === 'pytest' && any(/\d+ (passed|failed)/)) return { pass: n(/(\d+) passed/), fail: n(/(\d+) failed/) + n(/(\d+) error/), skip: n(/(\d+) skipped/) };
    return null;
  }
  globalThis.WorkbenchTestKit = { runnerFrom, TEST_FILE, kindOf, testsIn, testCommand, resultsOf, countsOf, ANSI };
})();
