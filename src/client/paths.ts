/** Plugin-owned read-only model route the card renders its rows from. */
export const QODER_MODELS_PATH = "/plugins/dsh-connect-qoder/models";
/** Plugin-owned read-only usage route the panel renders its quotas from. */
export const QODER_USAGE_PATH = "/plugins/dsh-connect-qoder/usage";
/** Plugin-owned read-only account route the panel renders its states from. */
export const QODER_ACCOUNT_PATH = "/plugins/dsh-connect-qoder/account";
/** Plugin-owned write route: re-read the sign-ins and start any region that came back. */
export const QODER_ACCOUNT_RELOAD_PATH = "/plugins/dsh-connect-qoder/account/reload";
/** Plugin-owned write route: the one online confirmation of a region's sign-in. */
export const QODER_ACCOUNT_CONFIRM_PATH = "/plugins/dsh-connect-qoder/account/confirm";
/**
 * Plugin-owned write route: claim the daily check-in.
 *
 * Region-scoped like `dsh-connect-workbuddy`'s equivalent route: the host owns
 * which round is live and never lets the card name a campaign of its own, so a
 * day-old round can never be claimed from a stale render.
 */
export const QODER_CHECKIN_PATH = "/plugins/dsh-connect-qoder/checkin";