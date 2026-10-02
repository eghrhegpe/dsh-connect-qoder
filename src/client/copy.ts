/**
 * Card copy — the public entry point.
 *
 * The actual translations live in three section files:
 * - `copy-row.ts` — model row labels, search, filter, off-peak
 * - `copy-usage.ts` — usage panel and daily check-in
 * - `copy-account.ts` — account panel and region tabs
 *
 * This file merges them into the single `{ zh, en }` shape the card expects,
 * so `index.ts` and `card.tsx` import from one place.
 */
import { zhRow, enRow } from "./copy-row.ts"
import { zhUsage, enUsage } from "./copy-usage.ts"
import { zhAccount, enAccount } from "./copy-account.ts"

/** Simplified Chinese copy. */
export const zh = { ...zhRow, ...zhUsage, ...zhAccount }
/** English copy. */
export const en = { ...enRow, ...enUsage, ...enAccount }
