/**
 * Unwrap a 0.1.7 volatile live reference.
 *
 * On the DSH 0.1.7 line a volatile settings field holds a `{ get() }` shell
 * rather than a value. Reading it directly yields the shell; `unwrapReference`
 * resolves it. This module is the single source for that logic — three copies
 * existed (in `preferences.js`, `catalog-entry.js`, and `settings-save.js`),
 * each with a comment saying "keeps this module importable on its own".
 *
 * @module dsh-connect-qoder/volatile
 */

/**
 * Resolve a value that may be a 0.1.7 volatile live reference.
 *
 * @param value - a field value, possibly a `{ get() }` shell.
 * @returns the resolved value.
 */
export function unwrapVolatile(value) {
  if (value !== null && typeof value === 'object' && typeof value.get === 'function') {
    return value.get()
  }
  return value
}
