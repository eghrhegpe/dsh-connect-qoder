/**
 * The usage section container.
 *
 * One of the two card containers that owns a `fetch` (the other is
 * `account-panel.tsx`). Both go through `./http.ts`, so the request contract
 * lives in exactly one place. This panel owns the quota read, the daily
 * check-in claim, and their two effects; the presentational pieces it renders
 * (`RegionUsage`, `CheckinCard`) stay in `card.tsx` as hook-free components.
 *
 * The split mirrors `dsh-connect-sensenova-token-plan`, where the assembly
 * module (`panel-page.ts`) imports a handful of focused containers rather than
 * holding every component itself. The card still renders identically — the
 * region strip, the usage block and the check-in card are the same nodes, in
 * the same order — only the module boundary moved.
 */
import * as react from "react"
import type { CardUsageRegion, CardAccountEntry, TranslateFn } from "./card-model.ts"
import { QODER_USAGE_PATH, QODER_CHECKIN_PATH } from "./paths.ts"
import { getJson, postJson } from "./http.ts"
import { RegionUsage, CheckinCard } from "./card.tsx"

/**
 * The usage section: a refresh control plus one block per region.
 *
 * The panel owns its own fetch rather than riding the model read, because
 * quota changes with every turn and must be refreshable on demand.
 *
 * `refreshToken` is the card's "the world changed, re-read" signal: when
 * the account panel's re-read lands, the card bumps it, and this panel
 * forces a fresh quota pull for what the host can now serve.
 */
interface QoderUsagePanelProps {
	t: TranslateFn
	refreshToken?: number
	activeRegion?: string
}

function QoderUsagePanel({ t, refreshToken = 0, activeRegion = "qoder-cn" }: QoderUsagePanelProps) {
	const [regions, setRegions] = react.useState<CardUsageRegion[]>([]);
	const [status, setStatus] = (0, react.useState)("loading");
	const [notice, setNotice] = (0, react.useState)<string | undefined>(undefined);
	const [busy, setBusy] = (0, react.useState)(false);
	const [claimBusy, setClaimBusy] = (0, react.useState)(false);
	const [claimNotice, setClaimNotice] = react.useState<{ kind?: string; message?: string; amount?: number } | undefined>(undefined);
	const mounted = (0, react.useRef)(true);
	(0, react.useEffect)(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const load = (0, react.useCallback)(async (refresh: boolean) => {
		setBusy(true);
		try {
			const value = await getJson<{ regions?: unknown }>(`${QODER_USAGE_PATH}${refresh ? "?refresh=1" : ""}`);
			if (!mounted.current) return;
			setRegions(Array.isArray(value.regions) ? (value.regions as CardUsageRegion[]) : []);
			setStatus("ready");
			setNotice(undefined);
		} catch (error) {
			if (!mounted.current) return;
			setStatus("error");
			setNotice(error instanceof Error ? error.message : String(error));
		} finally {
			if (mounted.current) setBusy(false);
		}
	}, []);
	// The daily check-in goes through the host rather than to Qoder: only the
	// host can say which round is live at the moment of the click, and a card
	// that carried its own campaign id could claim a round that closed
	// yesterday. The usage re-read follows every claim because the Credits land
	// in the add-on quota rendered a few lines above the button.
	const claimCheckin = (0, react.useCallback)(async () => {
		setClaimBusy(true);
		setClaimNotice(void 0);
		try {
			const value = await postJson<{ replayed?: unknown; amount?: unknown }>(`${QODER_CHECKIN_PATH}?region=${encodeURIComponent(activeRegion)}`);
			if (mounted.current) setClaimNotice({
				kind: value?.replayed === true ? "already" : "granted",
				// Absent when the upstream replayed the round: a repeat claim
				// grants nothing, so no amount is printed for it.
				amount: typeof value?.amount === "number" ? value.amount : void 0,
			});
			await load(true);
		} catch (error) {
			if (mounted.current) setClaimNotice({
				kind: "error",
				message: error instanceof Error ? error.message : String(error),
			});
		} finally {
			if (mounted.current) setClaimBusy(false);
		}
	}, [activeRegion, load]);
	(0, react.useEffect)(() => {
		void load(false);
	}, [load]);
	// The card's "the account just changed" signal: a re-read landed, so
	// re-pull the quota for whatever the host can serve now. The mount
	// effect already did the initial read, so a zero token must not
	// force a second fetch.
	(0, react.useEffect)(() => {
		if (refreshToken === 0) return;
		void load(true);
	}, [refreshToken, load]);
	// Scoped to the selected region (the convergence point on the version
	// strip), so only one usage block renders instead of one per region. The
	// fetch still pulls every region; this just picks the one the strip has
	// selected. The same selection drives the check-in card beside it.
	const active = regions.find((entry) => entry.region === activeRegion);
	return (
		<div className="dsm-qoder-usage-row">
			<div className="dsm-qoder-usage">
				<div className="dsm-qoder-usage-head">
					{/* The head is a stable title row: the panel title stays on
					    the left and the refresh control stays on the right.
					    Loading and error states render below it, next to the
					    selected region's block. */}
					<h4 className="dsm-qoder-usage-title">{t("usage.title")}</h4>
					<button
						type="button"
						className="dsm-qoder-button"
						disabled={busy}
						onClick={() => {
							void load(true);
						}}
					>
						{t("usage.refresh")}
					</button>
				</div>
				{status === "loading" ? <p className="dsm-qoder-hint">{t("usage.loading")}</p> : null}
				{status === "error" ? (
					<p className="dsm-qoder-error">{`${t("usage.error")}: ${notice ?? ""}`}</p>
				) : null}
				{active !== undefined ? (
					<RegionUsage t={t} entry={active} />
				) : (
					// The selected edition has no quota entry yet — it is not
					// signed in or not started — so say so instead of leaving
					// the panel body empty under its header.
					status === "ready" ? <p className="dsm-qoder-state">{t("usage.none")}</p> : null
				)}
			</div>
			{/* The daily check-in sits BESIDE the usage panel rather than as one
			    more stacked row inside it: as a row it spent a full-width line on
			    "每日签到" and one short button. It is only rendered when upstream
			    has a round running, so no permanently grey card is left behind —
			    and the panel then keeps the full width to itself. */}
			{active?.checkin !== undefined && active.checkin.active === true ? (
				<CheckinCard
					t={t}
					checkin={active.checkin}
					busy={claimBusy}
					notice={claimNotice}
					onClaim={() => {
						void claimCheckin();
					}}
				/>
			) : null}
		</div>
	);
}

// Re-exported so `account-panel.tsx` and `card.tsx` never reach across to
// an unrelated module for a type that belongs to the account surface.
export type { CardAccountEntry }
export { QoderUsagePanel }
