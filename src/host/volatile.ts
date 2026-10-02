/**
 * Unwrap a volatile live reference.
 *
 * On the DSH 0.2 line a volatile settings field holds a `{ get() }` shell
 * rather than a value. Reading it directly yields the shell; `unwrapVolatile`
 * resolves it. This module is the single source for that logic — three copies
 * existed (in `preferences.js`, `catalog-entry.js`, and `settings-save.js`),
 * each with a comment saying "keeps this module importable on its own".
 *
 * @module dsh-connect-qoder/volatile
 */

/**
 * A volatile settings field, as it is handed to this plugin.
 *
 * The live-reference shell. A plain value is a legal input too — callers pass
 * whatever the settings object carried — so the union has to admit both.
 */
export type VolatileRef<T> = T | { get(): T }

/**
 * Resolve a value that may be a volatile live reference.
 *
 * The `get()` call is made behind the runtime check below, which is what the
 * narrowing hinges on — an `as` would suppress exactly the property access this
 * guard is there to make legal.
 *
 * @param value - a field value, possibly a `{ get() }` shell.
 * @returns the resolved value.
 */
export function unwrapVolatile<T>(value: VolatileRef<T>): T {
  if (value !== null && typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function') {
    return (value as { get(): T }).get()
  }
  return value as T
}
