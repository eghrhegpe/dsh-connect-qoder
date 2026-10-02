/**
 * 最小 React / JSX 类型垫片，仅供 `tsc -p tsconfig.json` 类型检查使用。
 *
 * 跟隔壁 dsh-sensenova-provider 的 `src/client/react-shim.d.ts` 是同一个
 * 做法、同一条理由：宿主 Web 端在运行时由 `window.__ModuleLoader__` 的模块表
 * 提供真实的 `react` 与 `react/jsx-runtime`，客户端产物不打包它们；而
 * @types/react 没有（也不该）装进共享 profile 的 node_modules。所以不引依赖，
 * 只声明本卡片用到的极小子集。
 *
 * 与 sensenova 那份的两处差异，都是 `card.tsx` 的形状决定的：
 *
 * 1. **带 JSX 内建元素索引**。客户端自 2026-10 起是手写 `.tsx`（`jsx:
 *    "react-jsx"`，见文件尾的全局 `JSX` namespace），写 `<div>` 需要
 *    `JSX.IntrinsicElements`。早期从 `lib/client.js` 反推的转写本只用
 *    `(0, react_jsx_runtime.jsx)(...)` 调用、没有标签，那一段历史随
 *    `.tsx` 迁移结束；`jsx` / `jsxs` 仍保留声明，因为产物由 tsdown 转译，
 *    运行时仍走宿主模块表的 `react/jsx-runtime`。
 * 2. **多四个 hook**。卡片用到 useState / useEffect / useRef / useMemo /
 *    useCallback / useSyncExternalStore / Fragment，比 sensenova 那份多。
 *
 * 所有泛型参数都**不设 `any` 默认值**，否则等于把这里的隐式 any 挪个地方
 * 藏起来 —— 这份文件存在的意义正是让 card.tsx 能被 noImplicitAny 检查过。
 */
declare module 'react' {
  /**
   * 状态。第二个重载覆盖 `useState(undefined)`（卡片里用于「可清除的提示」），
   * 此时 `S` 推不出来，必须显式给出 `S = undefined` 并把 `undefined` 收进
   * 联合类型，否则 `setNotice(value)` 会报错。
   */
  export function useState<S>(initialState: S | (() => S)): [S, (value: S | ((prev: S) => S)) => void]
  export function useState<S = undefined>(): [
    S | undefined,
    (value: S | undefined | ((prev: S | undefined) => S | undefined)) => void,
  ]

  /**
   * 副作用。返回值是三态：清理函数、`undefined`（无可清理），或 `void` —— 卡片
   * 里三种写法都有（`useEffect(() => { ... })` 无返回、显式 `return undefined`、
   * 以及返回一个箭头函数）。`void` 单独列出是必需的：`() => { ... }` 推断为
   * `void`，而 `void` 不能赋给 `(() => void) | undefined`。
   */
  export function useEffect(effect: () => void | (() => void) | undefined, deps?: readonly unknown[]): void

  /**
   * 可变引用。返回可变对象而非 `Readonly`：卡片对它赋值（`mounted.current =
   * false`），`useRef(true)` 那种写法要能推断出 `{ current: boolean }`。
   *
   * `undefined` 的重载不是凑数：卡片里有一处 `useRef(useMemo(...))`，泛型在
   * 那个位置推不出来，只能给 `undefined`，于是 `T` 必须能取 `undefined`，
   * 否则返回类型会退化成 `never`。
   */
  export function useRef<T>(initialValue: T): { current: T }
  export function useRef<T = undefined>(): { current: T | undefined }

  /**
   * 记忆化计算值。`deps` 可省略（卡片里有多处只传回调）。
   *
   * `D` 与 `T` 分开而不是直接用 `T`：省略 `deps` 时 `T` 只能从工厂函数推，
   * 于是返回类型跟着 `deps` 的写法一起漂 —— 分开之后两种写法都推得出来。
   */
  export function useMemo<T, D extends readonly unknown[] | undefined = undefined>(
    factory: () => T,
    deps?: D,
  ): T

  /**
   * 记忆化回调。签名刻意不用 `T extends (...args: never[]) => unknown`——
   * 那个约束会让「把回调传给 `useCallback` 再调用」的推断塌成 `never`
   * （卡片里 `load(true)`、`setNotice(undefined)` 等十几处会因此报
   * 「not assignable to parameter of type 'never'」）。这里把参数表抽成
   * `A`、返回值抽成 `R`，返回类型 `(...args: A) => R` 既保持可调用，又
   * 不会像旧写法 `T extends (...args: any[]) => any` 那样给未标注参数
   * 一个上下文 `any` ——未标注的参数会报 implicit any（与真 React 一致）。
   *
   * `deps` 可省略：卡片里既有 `[deps]` 也有完全省略的写法。
   */
  export function useCallback<A extends unknown[], R>(
    callback: (...args: A) => R,
    deps?: readonly unknown[],
  ): (...args: A) => R

  /**
   * 订阅一个外部 store 并读其快照。`subscribe` 与 `getSnapshot` 都以裸函数
   * 传入，所以 `controller.ts` 里这两个方法是箭头属性（而非原型方法），否则
   * `this` 会丢；`getSnapshot` 必须返回引用稳定（直到下一次变更才换）的对象，
   * 否则 React 会拿旧值反复比较、死循环。
   *
   * 第三个参数 `getServerSnapshot` 可选：本卡片没有 SSR 场景，但 `react` 的
   * 真实签名里有，声明成可选能兼容 `useSyncExternalStore(a, b)` 两参写法。
   */
  export function useSyncExternalStore<T>(
    subscribe: (onStoreChange: () => void) => () => void,
    getSnapshot: () => T,
    getServerSnapshot?: () => T,
  ): T

  /**
   * `react.Fragment` 要在 .tsx 里直接当 JSX 标签用（`<react.Fragment
   * key=...>`），所以不能只声明成 `unknown`——TS 会报「没有调用/构造签
   * 名」。给它一个最小函数组件签名即可：运行时仍是宿主模块表里的真实
   * Fragment，这里只描述它「吃 children、返回节点」的形状。
   */
  export const Fragment: (props: { children?: unknown; key?: string | number | null }) => unknown
}

/**
 * 运行时的 JSX 降级结果构造器。
 *
 * `props` 可省略：转写本里无属性的自闭合标签降级成 `jsx("br")`，只有
 * `type` 一个实参 —— 这是该签名必须容忍的真实调用形状（卡片的 `<br>`）。
 *
 * 参数全部 `unknown`：调用点全是字面量（`"div"` 加一个对象），没有任何地方
 * 从这个返回值上读属性，所以更精确的类型只会带来噪音而不带来检查。
 */
declare module 'react/jsx-runtime' {
  export function jsx(type: unknown, props?: unknown, key?: string): unknown
  export function jsxs(type: unknown, props?: unknown, key?: string): unknown
  export const Fragment: unknown
}

/**
 * JSX 内建元素索引，供 `card.tsx` 在 `jsx: "react-jsx"` 下直接写标签。
 *
 * 与 alaxrpg/dsh-sensenova-provider 的垫片同一条做法：没有 @types/react
 * 可提供全局 JSX 命名空间，就声明一个最宽松的索引签名——元素属性全是
 * `unknown`，严格类型检查落在各调用点自己的事件类型标注上。
 */
declare namespace JSX {
  type Element = unknown
  interface IntrinsicAttributes {
    key?: string | number | null | undefined
  }
  interface IntrinsicElements {
    [elemName: string]: Record<string, unknown>
  }
}
