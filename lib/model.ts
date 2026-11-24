// Token Radar, model radar-2: the ranked board of pre-token protocols.
//
// The snapshot is the sealed DefiLlama pull: 758 protocols, no ranking, no implied
// value, no farm plan. This file derives all three from the snapshot's own figures,
// and nothing else: a protocol's TVL, its 7-day change, how long it has run with no
// token, how many chains it runs on, and how often its category has issued a token.
// No name is ever hardcoded; the model reads the figures, not the label.
//
// The board ranks every pre-token protocol the gate accepts: the 40 on the
// watchlist (TVL at or above the $50,000,000 floor) and every rankable protocol
// below the floor (the early radar). Protocols whose token already trades are set
// aside as a live list of 24, never ranked.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  gecko_id: string | null;
  symbol: string | null;
  listed_at: string | null;
}

export interface Snapshot {
  as_of: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied: number;
  growth_mult: number;
  maturity_mult: number;
  breadth_mult: number;
  category_mult: number;
  on_watchlist: boolean;
}

export interface RadarData {
  version: string;
  as_of: string;
  floor_usd: number;
  protocols: number;
  watchlist: number;
  watchlist_covered: number;
  early_size: number;
  live_size: number;
  model: {
    base_multiple: number;
    growth_weight_up: number;
    growth_weight_down: number;
    growth_floor: number;
    growth_cap: number;
    maturity_floor: number;
    maturity_range: number;
    maturity_days: number;
    unknown_age_days: number;
    breadth_step: number;
    breadth_cap: number;
    prior_floor: number;
    prior_range: number;
    prior_min_category: number;
  };
  category_rates: Record<string, number>;
  global_rate: number;
  rows: RadarRow[];
  live: RadarRow[];
}

/** The model's constants, stated once so the page and the dossier can repeat them. */
export const MODEL = {
  base_multiple: 0.25,
  growth_weight_up: 0.8,
  growth_weight_down: 0.4,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_step: 0.04,
  breadth_cap: 5,
  prior_floor: 0.85,
  prior_range: 0.3,
  prior_min_category: 10,
} as const;

export const MODEL_VERSION = 'radar-2';

/** A versioned name is a release line, not a protocol: "Foo V2", "Foo v1.3", "Foo 2.0". */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A protocol is pre-token when no market cap, no CoinGecko id and no symbol is recorded. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Rankable means pre-token, not a centralised exchange, and not a versioned release. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** Whole days between the snapshot date and listed_at, or null when unlisted. */
export function ageDays(p: SnapshotProtocol, asOf: string): number | null {
  if (p.listed_at === null) return null;
  const days = (Date.parse(asOf) - Date.parse(p.listed_at)) / 86_400_000;
  return Number.isFinite(days) ? Math.max(0, Math.floor(days)) : null;
}

/** Clamp a number into [lo, hi]. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** A finite number, or the fallback when the figure is missing or unusable. */
function finite(n: number | null, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

/**
 * The category prior, learned from the snapshot itself: for each category, the
 * share of its protocols that already have a token. Categories with fewer than
 * ten protocols fall back to the global rate, so a one-protocol category cannot
 * steer the board. Returns the per-category rates and the global rate.
 */
export function categoryRates(snapshot: Snapshot): { rates: Record<string, number>; global: number } {
  const totals = new Map<string, { n: number; withToken: number }>();
  let all = 0;
  let allWithToken = 0;
  for (const p of snapshot.protocols) {
    const category = p.category ?? 'Other';
    const entry = totals.get(category) ?? { n: 0, withToken: 0 };
    entry.n += 1;
    if (!isPreToken(p)) entry.withToken += 1;
    totals.set(category, entry);
    all += 1;
    if (!isPreToken(p)) allWithToken += 1;
  }
  const global = all === 0 ? 0.5 : allWithToken / all;
  const rates: Record<string, number> = {};
  for (const [category, entry] of totals) {
    rates[category] = entry.n >= MODEL.prior_min_category ? entry.withToken / entry.n : global;
  }
  return { rates, global };
}

export interface ModelBreakdown {
  implied: number;
  growth_pct: number;
  growth_mult: number;
  maturity_mult: number;
  breadth_mult: number;
  category_mult: number;
  age_days: number | null;
}

/**
 * The implied value of a pre-token protocol, and every factor that built it.
 *
 *   implied = TVL x 0.25 x growth x maturity x breadth x category prior
 *
 * base: TVL x 0.25. A token's fully diluted value usually clears a quarter of
 * the value locked in the protocol; 0.25 is the anchor, not a guess at any name.
 *
 * growth: the 7-day change, clamped to [-60, +120] so one week's spike cannot
 * dominate the board. A rise counts more than a fall of the same size (0.8
 * against 0.4): growth is a signal that a launch is coming, while a fall is a
 * weaker signal of the opposite.
 *
 * maturity: 0.6 + min(age, 1095) / 1095 x 0.4. A protocol that has run three
 * years with no token is likelier to issue one than one listed last month.
 * An unlisted protocol is treated as a year old.
 *
 * breadth: 1 + 0.04 x min(chains - 1, 5). A protocol live on more chains
 * reaches more farmers and more liquidity; the fifth extra chain is the last
 * one that counts.
 *
 * category prior: 0.85 + 0.30 x token rate. Categories where tokens are the
 * norm (lending, dexes) score above categories where they are rare (risk
 * curators). The rate is computed from this snapshot, not asserted.
 */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  rates: Record<string, number>,
): ModelBreakdown {
  const age = ageDays(p, asOf) ?? MODEL.unknown_age_days;
  const growthPct = clamp(finite(p.change_7d, 0), MODEL.growth_floor, MODEL.growth_cap);
  const growthWeight = growthPct >= 0 ? MODEL.growth_weight_up : MODEL.growth_weight_down;
  const growthMult = 1 + (growthPct / 100) * growthWeight;
  const maturityMult = MODEL.maturity_floor + (Math.min(age, MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range;
  const breadthMult = 1 + MODEL.breadth_step * Math.min(Math.max(p.chains.length - 1, 0), MODEL.breadth_cap);
  const rate = rates[p.category ?? 'Other'] ?? 0.5;
  const categoryMult = MODEL.prior_floor + MODEL.prior_range * rate;
  const implied = Math.max(1, Math.round(p.tvl_usd * MODEL.base_multiple * growthMult * maturityMult * breadthMult * categoryMult));
  return {
    implied,
    growth_pct: growthPct,
    growth_mult: growthMult,
    maturity_mult: maturityMult,
    breadth_mult: breadthMult,
    category_mult: categoryMult,
    age_days: ageDays(p, asOf),
  };
}

/** The capital a farm should put in, from the protocol's TVL tier. */
function farmCapital(tvlUsd: number): number {
  if (tvlUsd >= 5_000_000_000) return 250;
  if (tvlUsd >= 1_000_000_000) return 150;
  if (tvlUsd >= 100_000_000) return 100;
  return 50;
}

/** How long the position should stay open, from the protocol's age. */
function holdDays(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The main position, from the protocol's category, on its first chain. */
function mainAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const category = (p.category ?? '').toLowerCase();
  const money = `$${capital}`;
  if (category.includes('lend') || category.includes('cdp') || category.includes('collateral') || category.includes('money market')) {
    return `Supply ${money} of USDC to the lending pool on ${chain} so your address earns supply interest and shows as an active lender. Gas about $3, 5 minutes.`;
  }
  if (category.includes('dex') || category.includes('swap') || category.includes('amm')) {
    return `Add ${money} of liquidity to the busiest USDC pool on ${chain} and hold the position, so your address earns trading fees and shows as a liquidity provider. Gas about $2, 5 minutes.`;
  }
  if (category.includes('yield') || category.includes('vault') || category.includes('leveraged') || category.includes('farm')) {
    return `Deposit ${money} of USDC into the highest-TVL yield vault on ${chain}, so your address earns vault yield and shows as a depositor. Gas about $2, 5 minutes.`;
  }
  if (category.includes('bridge') || category.includes('canonical')) {
    return `Bridge ${money} of USDC from Ethereum to ${chain} through the protocol's own bridge, so your address shows a completed bridge transfer. Bridge fee about $2, 15 minutes.`;
  }
  if (category.includes('stak') || category.includes('restak') || category.includes('liquid')) {
    return `Stake ${money} of the protocol's liquid-staking token on ${chain}, so your address earns staking yield and shows as a staker. Gas about $2, 5 minutes.`;
  }
  if (category.includes('perpetual') || category.includes('derivative') || category.includes('option') || category.includes('prediction')) {
    return `Open a small ${money} long with low leverage on ${chain}, then hedge it with a matching short on another venue so the position stays near neutral. Trading fees about $1, 15 minutes.`;
  }
  if (category.includes('curator') || category.includes('allocator')) {
    return `Deposit ${money} of USDC into the curated vault on ${chain}, so your address earns curator-managed yield and shows as a vault depositor. Gas about $2, 5 minutes.`;
  }
  if (category.includes('stable')) {
    return `Mint ${money} of the protocol's stablecoin against USDC on ${chain} and hold it, so your address shows as a minter. Gas about $2, 5 minutes.`;
  }
  if (category.includes('rwa') || category.includes('real world')) {
    return `Mint ${money} of the protocol's yield-bearing real-world asset on ${chain} and hold it, so your address shows as a holder. Gas about $2, 10 minutes.`;
  }
  if (category.includes('insurance')) {
    return `Buy ${money} of cover for a lending pool on ${chain}, so your address shows as a policy holder and earns cover fees. Premium about $1, 10 minutes.`;
  }
  return `Deposit ${money} of USDC into the protocol's main product on ${chain} and leave it working, so your address shows as an active user. Gas about $2, 5 minutes.`;
}

/** A second qualifying action, from the category and the chains it runs on. */
function secondAction(p: SnapshotProtocol, secondChain: string | null): string {
  const category = (p.category ?? '').toLowerCase();
  if (category.includes('bridge') || category.includes('canonical')) {
    return `Bridge $25 back to Ethereum a week later, so your address shows activity in both directions and not a single one-way transfer. Bridge fee about $2, 15 minutes.`;
  }
  if (category.includes('dex') || category.includes('swap') || category.includes('amm')) {
    return `Swap $25 of USDC for the pool's paired asset once, so your address also shows swap volume and not only a liquidity deposit. Gas about $1, 3 minutes.`;
  }
  if (category.includes('lend') || category.includes('cdp') || category.includes('collateral') || category.includes('money market')) {
    return `Borrow $20 against the supplied USDC and repay it the same week, so your address shows a borrow event as well as a supply. Interest under $1, 10 minutes.`;
  }
  if (secondChain !== null) {
    return `Repeat a smaller position of about $50 on ${secondChain}, so the farm covers a second chain the protocol runs on instead of a single network. Gas about $1, 10 minutes.`;
  }
  return `Make one more transaction of a different kind, such as a small swap, so your address shows more than a single action. Gas about $1, 5 minutes.`;
}

/**
 * The farm plan: seven steps, each with what it costs and how long it takes,
 * derived from the protocol's category, chains, TVL and age. No step is a
 * slogan; every step names an action, a dollar figure and a time.
 */
export function farmSteps(p: SnapshotProtocol, asOf: string): string[] {
  const capital = farmCapital(p.tvl_usd);
  const age = ageDays(p, asOf);
  const hold = holdDays(age);
  const weeks = Math.max(2, Math.round(hold / 7));
  const chain = p.chains[0] ?? 'Ethereum';
  const secondChain = p.chains.length > 1 ? (p.chains[1] ?? null) : null;
  return [
    `Set up a fresh wallet for this farm only, write its 12-word seed on paper and store it offline, and never reuse a wallet that holds other funds. Takes about 10 minutes and costs nothing.`,
    mainAction(p, capital, chain),
    secondAction(p, secondChain),
    `Repeat the qualifying action once a week for ${weeks} weeks, about $10 of new activity each time, so the address stays active across snapshots instead of going quiet. Gas about $1 a week, 5 minutes a week.`,
    `Keep the position open for at least ${hold} days; closing early can drop the address from a snapshot the team takes without warning. No extra cost, just patience.`,
    `Check the protocol's points or rewards page and its announcements once a week for a points program, a snapshot date or a token hint, and set a reminder so a short window is not missed. Free, 5 minutes a week.`,
    `When a claim opens, verify the claim link from the protocol's own announcements, claim with the farm wallet, and record the transaction hash in your farm log. Gas about $2, 10 minutes.`,
  ];
}

/** One dashboard row: the ranked figures plus the model's factors, for the page. */
function radarRow(
  p: SnapshotProtocol,
  rank: number,
  asOf: string,
  rates: Record<string, number>,
  onWatchlist: boolean,
): RadarRow {
  const model = impliedValue(p, asOf, rates);
  return {
    rank,
    slug: p.slug,
    name: p.name,
    category: p.category ?? 'Other',
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    age_days: model.age_days,
    implied: model.implied,
    growth_mult: model.growth_mult,
    maturity_mult: model.maturity_mult,
    breadth_mult: model.breadth_mult,
    category_mult: model.category_mult,
    on_watchlist: onWatchlist,
  };
}

/** Score the snapshot into the ranked board and the dashboard's data. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { rates, global } = categoryRates(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  // Above the floor the watchlist is the authority: it already excluded the
  // wrapped, staked and bridged products (a wrapped bitcoin, a staked-ETH
  // receipt, a canonical bridge) that pass the bare rankable predicate but
  // will never launch a token of their own. Below the floor the radar finds
  // every rankable protocol.
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = snapshot.protocols.find((x) => x.slug === slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()]
    .map((p) => ({ p, model: impliedValue(p, snapshot.as_of, rates) }))
    .sort((a, b) => b.model.implied - a.model.implied || a.p.slug.localeCompare(b.p.slug));

  const board: BoardRow[] = scored.map(({ p, model }, i) => ({
    slug: p.slug,
    name: p.name,
    rank: i + 1,
    implied_value_usd: model.implied,
    farm_steps: farmSteps(p, snapshot.as_of),
  }));

  const rows = scored.map(({ p }, i) => radarRow(p, i + 1, snapshot.as_of, rates, watchlist.has(p.slug)));
  const live = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .slice(0, 24)
    .map((p, i) => radarRow(p, i + 1, snapshot.as_of, rates, watchlist.has(p.slug)));

  const radar: RadarData = {
    version: MODEL_VERSION,
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    protocols: snapshot.protocols.length,
    watchlist: snapshot.watchlist.length,
    watchlist_covered: rows.filter((r) => r.on_watchlist).length,
    early_size: rows.filter((r) => !r.on_watchlist).length,
    live_size: live.length,
    model: { ...MODEL },
    category_rates: rates,
    global_rate: global,
    rows,
    live,
  };
  return { board, radar };
}

/** The dashboard's data, as one script the page loads beside itself. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

/** Parse the sealed snapshot, refusing a malformed file rather than guessing. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error('token radar: the snapshot is not JSON');
  }
  if (typeof raw !== 'object' || raw === null) throw new Error('token radar: the snapshot is not an object');
  const s = raw as Record<string, unknown>;
  if (typeof s.as_of !== 'string' || typeof s.floor_usd !== 'number' || !Array.isArray(s.protocols) || !Array.isArray(s.watchlist)) {
    throw new Error('token radar: the snapshot is missing as_of, floor_usd, protocols or watchlist');
  }
  const protocols: SnapshotProtocol[] = [];
  for (const entry of s.protocols as unknown[]) {
    if (typeof entry !== 'object' || entry === null) throw new Error('token radar: a protocol entry is not an object');
    const p = entry as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || !Array.isArray(p.chains) || typeof p.tvl_usd !== 'number') {
      throw new Error('token radar: a protocol entry is missing slug, name, chains or tvl_usd');
    }
    protocols.push({
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: p.chains as string[],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' ? p.mcap_usd : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
    });
  }
  return {
    as_of: s.as_of,
    floor_usd: s.floor_usd,
    protocols,
    watchlist: s.watchlist as string[],
  };
}

/**
 * The gate's own checks on the board, in the gate's words: 100 to 4,000 rows,
 * ranks exactly 1 to N, positive whole-dollar implied values, non-increasing
 * down the ranks, not all the same, 3 to 12 farm steps of 20 to 600 characters,
 * every watchlist slug covered, at least 60 rows outside the watchlist.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `board_file: ${board.length} rows is fewer than the 100 the board must hold`;
  if (board.length > 4000) return `board_file: ${board.length} rows is more than the 4,000 the board may hold`;
  const seenRanks = new Set<number>();
  let previous = Number.POSITIVE_INFINITY;
  let allSame = true;
  let first: number | null = null;
  for (const row of board) {
    if (row.rank < 1 || row.rank > board.length) return `board_file: rank ${row.rank} is outside 1 to ${board.length}`;
    if (seenRanks.has(row.rank)) return `board_file: rank ${row.rank} appears more than once`;
    seenRanks.add(row.rank);
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return `sorted_by_value: row ${row.rank} (${row.slug}) has an implied value of ${row.implied_value_usd}, not a positive whole dollar amount`;
    }
    if (row.implied_value_usd > previous) return `sorted_by_value: row ${row.rank} (${row.slug}) is worth more than the row above it`;
    if (first === null) first = row.implied_value_usd;
    else if (row.implied_value_usd !== first) allSame = false;
    previous = row.implied_value_usd;
    if (row.farm_steps.length < 3) return `farm_steps: row ${row.rank} (${row.slug}) holds ${row.farm_steps.length} steps, fewer than 3`;
    if (row.farm_steps.length > 12) return `farm_steps: row ${row.rank} (${row.slug}) holds ${row.farm_steps.length} steps, more than 12`;
    for (const step of row.farm_steps) {
      const trimmed = step.trim();
      if (trimmed.length < 20) return `farm_steps: row ${row.rank} (${row.slug}) has a step of ${trimmed.length} characters, shorter than 20`;
      if (trimmed.length > 600) return `farm_steps: row ${row.rank} (${row.slug}) has a step of ${trimmed.length} characters, longer than 600`;
    }
  }
  if (allSame) return 'sorted_by_value: every row carries the same implied value';
  const covered = new Set(board.map((r) => r.slug));
  for (const slug of snapshot.watchlist) {
    if (!covered.has(slug)) return `coverage: the watchlist names ${slug}, which the board never ranks`;
  }
  const outside = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  if (outside < 60) return `coverage: ${outside} rows name protocols outside the watchlist, fewer than 60`;
  return null;
}
