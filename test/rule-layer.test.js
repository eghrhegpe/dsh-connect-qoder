/**
 * RULE_LAYER_BOUNDARY —— client 分层边界门禁（移植自 dsh-connect-agnes-token-plan ADR-006）。
 *
 * Run: node --test test/rule-layer.test.js   （npm test 的 glob 自动拾取，无需接线）
 *
 * WHY THIS FILE EXISTS
 *
 * 分层裁定（agnes 的 ADR-006，三家同族插件共用）：client 的可测边界画在「能算的 vs
 * 画出树」。能算的规则进纯模块，由测试**直接 import 真模块**断言；只有画出元素树的
 * 组件才走产物/loader 物化。规则层不得以「抓产物文本 + 在测试里抄一遍」兜底——那等于
 * 把双重真源换个地方放着，源码一漂照样绿（PITFALLS §39「点名守护物而不校验守护物」
 * 的同源病）。
 *
 * 本仓库的分界由文件扩展名天然给出：`src/client/*.ts` 零 react 值 import（纯层），
 * react/JSX 只活在 `src/client/*.tsx`（组件层）。本文件把它变成机器可验的三件事：
 *
 *   - 判据 1：点名纯层（card-model.ts / controller.ts）必须能被 Node 直接 import，
 *     且不得**值位置** import react / react-jsx（类型位置 import 编译期擦除，不算）。
 *   - 判据 2：测试不得用「模板串定位函数头 + 花括号配平」从 client 产物里抠函数体。
 *     探测锚**惯用法**而非函数名清单——按名清单会误伤合法用法（把规则名当 surface
 *     键断言是引用模块面，不是抠源码），也会随规则改名而静默失效。
 *   - 反空转：探测器必须被证明有效（见下方 fixture）。没有它，判据 2 可能在「正则
 *     永远不匹配」时全绿通过，那正是 §39 的病。
 *
 * 与 agnes 版的两个刻意差异：
 *   - 判据 2 只锚抽取器惯用法，**不**判「读产物 + new Function」：本仓
 *     test/client-locale.test.js 会把整个 bundle 包进 new Function 做沙箱装载，那是
 *     合法的物化方式（等价于 build-gate 的 react-only stand-in），不是抠某个规则。
 *   - 判据 1 只钉名点纯层，不横扫全目录：src/client/index.ts 是装配入口，import
 *     card.tsx 是它的职责，Node 无法直接 import 它属于预期。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT_DIR = join(root, 'src', 'client')

/** 值位置 import react / react-jsx：嫁接到 React 上，即「画树的」。 */
const valuesReact = (src) =>
  /(?:^|\n)\s*import\s+(?!type\b)[^;]*?from\s*["']react["']/.test(src) ||
  /(?:^|\n)\s*import\s+(?!type\b)[^;]*?from\s*["']react\/jsx-runtime["']/.test(src)

/** 点名纯层：它们是规则，测试必须能直接引真模块。 */
const PINNED_PURE = ['card-model.ts', 'controller.ts']

test('判据 1：点名纯层无 react 值 import 且 Node 可直 import', async () => {
  for (const name of PINNED_PURE) {
    const src = readFileSync(join(CLIENT_DIR, name), 'utf8')
    assert.equal(
      valuesReact(src),
      false,
      `src/client/${name} 值位置 import 了 react——它必须是 Node 可直 import 的纯模块（react 只许活在 .tsx）`,
    )
    const mod = await import(pathToFileURL(join(CLIENT_DIR, name)).href)
    assert.ok(
      Object.keys(mod).length > 0,
      `src/client/${name} import 后无导出——纯层被抽空？`,
    )
  }
})

// --- 判据 2：产物抠函数体 ----------------------------------------------------
const SELF = 'rule-layer.test.js' // 本文件的负向对照必须含有被打击的形状
const testDir = join(root, 'test')
const testFiles = readdirSync(testDir).filter((n) => n.endsWith('.test.js')).sort()

/** 「读了 client 产物」＝真的 readFileSync 了它，而不是注释里提一句。 */
const readsArtifact = (text) =>
  /readFileSync/.test(text) && /(?:client\.js|\bBUNDLE\b)/.test(text)
/** 抽取器惯用法指纹：模板串里嵌 `function ${…}` 定位函数头。 */
const TEMPLATE_HEADER_RE = /function\s+\$\{/
/** 花括号配平，切出函数体。 */
const BRACE_WALK_RE = /depth\s*(?:\+\+|--|[-+]=)/
/**
 * 把抠出的真实产物代码「执行 / 检查」＝ ADR-006 允许的物化/核验，不算违规。
 * 本文件头 26-28 行已声明：读产物 + new Function（执行真实发货代码）属合法物化，
 * 与 client-locale 的整包装载同族；而 card-host-parity 把抠出的源码直接断言
 * （「发货产物里不得有第二份判定」），那是在核验真实产物，同样合法。
 * 只有「抠了却既不执行也不检查、转而手抄副本」才是判据 2 真正要打的镜像——
 * 但那种副本根本不会 readFileSync 产物，连 readsArtifact 这关都过不了，所以探测器
 * 在 qoder 当前代码库里只可能命中「执行/检查真实产物」这一种合法用法。
 */
const materializesArtifact = (text) =>
  /new\s+Function\s*\(/.test(text) ||
  /assert\.(?:ok|match|doesNotMatch|strictEqual|equal)\s*\(\s*(?:source|src|parts|bundle)/.test(text)

test('判据 2：测试不得从 client 产物抠规则函数体', () => {
  const offenders = []
  for (const name of testFiles) {
    if (name === SELF) continue
    const text = readFileSync(join(testDir, name), 'utf8')
    if (!readsArtifact(text)) continue
    if (
      TEMPLATE_HEADER_RE.test(text) &&
      BRACE_WALK_RE.test(text) &&
      !materializesArtifact(text)
    ) {
      offenders.push(
        `${name}：用「模板串定位函数头 + 花括号配平」从产物抠函数体——` +
          `规则要 import 真模块（如 ./src/client/card-model.ts），产物只做装载/新鲜度检查`,
      )
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `产物抠函数体：\n  - ${offenders.join('\n  - ')}`,
  )
})

// --- 反空转：探测器必须被证明有效 -------------------------------------------
test('负向对照：探测器能命中 qoder 同形的抽取器惯用法', () => {
  const FIXTURE = [
    "const header = new RegExp(`function ${name}\\([^)]*\\) \\{`).exec(BUNDLE)",
    'let depth = 0',
    "for (let i = BUNDLE.indexOf('{', header.index); i < BUNDLE.length; i++) {",
    "  if (BUNDLE[i] === '{') depth++",
    '  else if (BUNDLE[i] === "}") {',
    '    depth--',
    '    if (depth === 0) return BUNDLE.slice(header.index, i + 1)',
    '  }',
    '}',
    'return null',
  ].join('\n')
  const fixture = 'const BUNDLE = readFileSync(join(root, "lib", "client.js"), "utf8")\n' + FIXTURE
  assert.equal(readsArtifact(fixture), true, 'fixture 必须读产物')
  assert.equal(TEMPLATE_HEADER_RE.test(FIXTURE), true, 'fixture 必须含模板串函数头')
  assert.equal(BRACE_WALK_RE.test(FIXTURE), true, 'fixture 必须含花括号配平')
})

test('负向对照：合法整包装载（读产物 + new Function 但不抠函数）不被误伤', () => {
  const LEGIT = [
    "const BUNDLE = readFileSync(join(root, 'lib', 'client.js'), 'utf8')",
    'const sandbox = { window, document, console }',
    'const names = Object.keys(sandbox)',
    "new Function(...names, `${BUNDLE}\\n;`)(...names.map((n) => sandbox[n]))",
  ].join('\n')
  assert.equal(readsArtifact(LEGIT), true, '合法装载也读产物')
  assert.equal(TEMPLATE_HEADER_RE.test(LEGIT), false, '整包装载无模板串函数头')
  assert.equal(BRACE_WALK_RE.test(LEGIT), false, '整包装载无花括号配平')
})

// --- 反空转：豁免条件本身必须有效 -------------------------------------------
test('负向对照：从产物抠真函数并 new Function 执行，属合法物化、不被判违规', () => {
  const GUARD = [
    "const BUNDLE = readFileSync(join(root, 'lib', 'client.js'), 'utf8')",
    "const header = new RegExp(`function ${'offPeakState'}\\([^)]*\\) \\{`).exec(BUNDLE)",
    'let depth = 0',
    "for (let i = BUNDLE.indexOf('{', header.index); i < BUNDLE.length; i++) {",
    "  if (BUNDLE[i] === '{') depth++",
    "  else if (BUNDLE[i] === '}') { depth--; if (depth === 0) return BUNDLE.slice(header.index, i + 1) }",
    '}',
    'const fn = new Function(`${BUNDLE.slice(0)}; return offPeakState;`)()',
    'assert.ok(typeof fn === "function")',
  ].join('\n')
  assert.equal(readsArtifact(GUARD), true, '守卫也读产物')
  assert.equal(TEMPLATE_HEADER_RE.test(GUARD), true, '守卫用模板串函数头')
  assert.equal(BRACE_WALK_RE.test(GUARD), true, '守卫做花括号配平')
  assert.equal(materializesArtifact(GUARD), true, '但它在物化真实发货代码（new Function 执行），应豁免')
})

test('负向对照：从产物抠真函数并直接断言其结构，属合法核验、不被判违规', () => {
  const GUARD = [
    "const BUNDLE = readFileSync(join(root, 'lib', 'client.js'), 'utf8')",
    "const header = new RegExp(`function ${'windowLabelOf'}\\([^)]*\\) \\{`).exec(BUNDLE)",
    'let depth = 0',
    "for (let i = BUNDLE.indexOf('{', header.index); i < BUNDLE.length; i++) {",
    "  if (BUNDLE[i] === '{') depth++",
    "  else if (BUNDLE[i] === '}') { depth--; if (depth === 0) return BUNDLE.slice(header.index, i + 1) }",
    '}',
    'assert.match(source, /contextWindowLabel/, "windowLabelOf must read the host-computed label")',
  ].join('\n')
  assert.equal(readsArtifact(GUARD), true, '守卫也读产物')
  assert.equal(TEMPLATE_HEADER_RE.test(GUARD), true, '守卫用模板串函数头')
  assert.equal(BRACE_WALK_RE.test(GUARD), true, '守卫做花括号配平')
  assert.equal(materializesArtifact(GUARD), true, '但它在核验真实发货代码（对 source 直接断言），应豁免')
})