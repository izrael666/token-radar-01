// radar-2: the token radar's scoring model.
//
// One sealed snapshot in, one ranked board out. The board is every pre-token protocol the
// snapshot can rank: the 40-protocol watchlist (TVL at or above the $50M floor) is the floor,
// never the ceiling, and the early radar is every other rankable protocol, 158 of them. A
// protocol is pre-token when its record carries no token at all — no market cap, no CoinGecko id,
// no symbol — and it is rankable when it is not a wrapped, staked or bridged product of a token
// that already trades. The snapshot's own brief says why: WBTC is Bitcoin on Ethereum, Binance
// staked ETH is ETH in Binance's staking product, and neither is a protocol still waiting on a
// launch of its own. Live-token protocols are set aside and shown with the market's own values,
// never mixed into the ranking. Call a protocol pre-token because its record carries no token,
// never because it has none: a record may simply not carry a token it already has.
//
// A protocol's implied value is one function of the snapshot's own figures, the same function
// for every row, no name ever special-cased:
//
//   base     = tvl_usd * 0.25
//   growth   = clamp(change_7d, -60, 120) percent, weight 0.5
//   maturity = 0.6 + min(age_days, 1095) / 1095 * 0.4   (unknown age: 365 days)
//   chains   = 1 + 0.04 * min(max(chains - 1, 0), 4)    (1.00 to 1.16)
//   implied  = max(1, round(base * (1 + growth/100*0.5) * maturity * chains))
//
// TVL is the size of the launch, seven-day growth is its momentum, age is how long it has run
// with no token (a protocol that waited years has more pent-up launch value than a new one), and
// chain count is its distribution: a protocol live on several chains reaches more wallets than
// one on a single chain. The farm plan is a rule table keyed by category, never by name: the
// protocol's own category, chains, TVL and age decide its action, its capital, its hold and
// every cost and time.

/** One protocol entry, exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated on the dashboard. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_max_extra: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.04,
  chain_max_extra: 4,
};

/** The model's version label, named by the dashboard. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A board row in the compact form data.js carries; the page regenerates the farm plan from it. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  watchlist: boolean;
}

/** A live-token protocol: it already trades, so the dashboard shows the market's value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders: the board, the live set, and the model that scored it. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** The headline figures: watchlist size, board size, early rows, live rows. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** Thrown when the snapshot is not the shape this model scores. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** `value` when it is a finite number, else `fallback`. */
function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const from = Date.parse(`${asOf}T00:00:00Z`);
  const since = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(since)) return null;
  return Math.max(0, Math.floor((from - since) / DAY_MS));
}

/** A deterministic hash of a slug, for picking between two weekly actions. No randomness anywhere:
 *  the program runs twice and both runs must write the same bytes. */
function slugHash(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return h;
}

/** The three multipliers for one protocol under the model. */
function multipliers(p: SnapshotProtocol, asOf: string, m: ModelConstants): { growthPct: number; growth: number; maturity: number; chain: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const growthPct = Math.min(m.growth_cap, Math.max(m.growth_floor, num(p.change_7d, 0)));
  const growth = 1 + (growthPct / 100) * m.growth_weight;
  const aged = age ?? m.unknown_age_days;
  const maturity = m.maturity_floor + (Math.min(Math.max(aged, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
  const spread = Math.min(Math.max(p.chains.length - 1, 0), m.chain_max_extra);
  return { growthPct, growth, maturity, chain: 1 + m.chain_step * spread, age };
}

/** The implied value one protocol gets, with the multipliers that produced it. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): { implied: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
  const x = multipliers(protocol, asOf, model);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * model.base_multiple * x.growth * x.maturity * x.chain));
  return { implied, growthPct: x.growthPct, growthMult: x.growth, maturityMult: x.maturity, chainMult: x.chain, age: x.age };
}

/** A name ending in a release marker is a pool of another protocol, not its own launch. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word that marks a wrapped, staked or bridged product of a token that already trades. */
const WRAPPED_OR_STAKED = /\b(wrapped|staked|staking)\b/i;
/** An exchange's name at the start of a protocol's name: the exchange's product, not its own launch. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
/** The categories the house's watchlist rule leaves out: a bridge, a liquid-staking product or an
 *  exchange is a product of a token that already trades. The board applies the house's rule to
 *  the whole universe, not just the $50M floor. */
const EXCLUDED_CATEGORY = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** True when the record carries no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** True when the board may rank the protocol: pre-token, and not a wrapped, staked or bridged
 *  product of a token that already trades. The watchlist applies the same rule, so no watchlist
 *  slug is ever lost to it. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORY.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_OR_STAKED.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** One farm rule: the category words it matches, the action it gives, and its two weekly actions.
 *  The first rule whose words appear in the category wins; the table is the whole plan, no name
 *  is ever looked up. */
interface FarmRule {
  keys: string[];
  action: (name: string, capital: number, chain: string) => string;
  weekly: [string, string];
}

/** The weekly pair every rule without its own falls back to. */
const WEEKLY_DEFAULT: [string, string] = [
  'Make one qualifying action, such as a deposit, a borrow, a swap or a vote.',
  'Use the protocol once, in the way its own docs describe as activity.',
];

const FARM_RULES: FarmRule[] = [
  {
    keys: ['lend', 'cdp', 'collateral'],
    action: (name, capital, chain) => `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`,
    weekly: ['Borrow a small amount against the supply once, then repay it the same week.', 'Top the supply up by a few dollars and leave the position open.'],
  },
  {
    keys: ['dex', 'yield', 'leveraged farm', 'liquidity manager', 'farm'],
    action: (name, capital, chain) => `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`,
    weekly: ['Swap a small amount through the pool so the position shows trading activity.', 'Add a few dollars of liquidity and claim any fees the pool paid.'],
  },
  {
    keys: ['bridge', 'cross chain'],
    action: (name, capital, chain) => `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`,
    weekly: ['Bridge a small amount back and forth so both sides of the route are used.', 'Use the bridged funds in one app on the destination chain.'],
  },
  {
    keys: ['staking', 'restak', 'anchor btc', 'decentralized btc'],
    action: (name, capital, chain) => `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`,
    weekly: ['Restake the rewards the position earned instead of withdrawing them.', 'Check the staking receipt and keep it in the same wallet.'],
  },
  {
    keys: ['perpetual', 'derivative', 'basis trading'],
    action: (name, capital, chain) => `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`,
    weekly: ['Close the hedge and open a fresh one at a smaller size.', 'Adjust the margin by a few dollars and keep the position open.'],
  },
  {
    keys: ['prediction'],
    action: (name, capital) => `Fund $${capital} and place one market position on ${name}.`,
    weekly: ['Settle one market and open a fresh position on another.', 'Vote on one market outcome with a small stake.'],
  },
  {
    keys: ['curator', 'allocator'],
    action: (name, capital, chain) => `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`,
    weekly: ['Move a few dollars between the vaults the curator offers.', 'Check the vault allocation and rebalance a small amount.'],
  },
  {
    keys: ['rwa'],
    action: (name, capital, chain) => `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`,
    weekly: WEEKLY_DEFAULT,
  },
  {
    keys: ['stable'],
    action: (name, capital, chain) => `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`,
    weekly: WEEKLY_DEFAULT,
  },
  {
    keys: ['insurance'],
    action: (name, capital, chain) => `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`,
    weekly: WEEKLY_DEFAULT,
  },
  {
    keys: ['index'],
    action: (name, capital, chain) => `Buy $${capital} of the ${name} index on ${chain} and hold the shares.`,
    weekly: WEEKLY_DEFAULT,
  },
  {
    keys: ['payment', 'card issuer'],
    action: (name, capital) => `Order the ${name} card, load $${capital} onto it and spend from it once a week.`,
    weekly: WEEKLY_DEFAULT,
  },
  {
    keys: ['governance'],
    action: (name, capital, chain) => `Lock $${capital} of the governance asset in ${name} on ${chain} and vote on one proposal.`,
    weekly: WEEKLY_DEFAULT,
  },
  {
    keys: ['otc'],
    action: (name, capital, chain) => `Request a $${capital} quote on ${name} and settle one trade on ${chain}.`,
    weekly: WEEKLY_DEFAULT,
  },
  {
    keys: ['cedefi'],
    action: (name, capital, chain) => `Deposit $${capital} of USDC into the ${name} vault on ${chain} and keep the shares.`,
    weekly: WEEKLY_DEFAULT,
  },
];

/** The rule for a category, or null when no rule's words appear in it. */
function ruleFor(category: string | null): FarmRule | null {
  const c = (category ?? '').toLowerCase();
  for (const rule of FARM_RULES) {
    for (const key of rule.keys) if (c.includes(key)) return rule;
  }
  return null;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** The hold, in days, from the protocol's age: younger protocols need more snapshots to count. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 90) return 90;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** One step as a single string: its action, then its cost and time, inside the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age) through the rule table, never from a list of
 * names. The fifth step is the one farmers skip and regret: check the domain before you sign.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const rule = ruleFor(p.category);
  let action: string;
  let weekly: string;
  if (rule !== null) {
    action = rule.action(p.name, capital, chain);
    weekly = rule.weekly[slugHash(p.slug) % 2]!;
  } else if ((p.category ?? '').toLowerCase() === 'chain') {
    action = `Bridge $${capital} of USDC to ${chain} and use one of its apps through ${p.name} every week.`;
    weekly = WEEKLY_DEFAULT[slugHash(p.slug) % 2]!;
  } else {
    action = `Deposit $${capital} of USDC into ${p.name} on ${chain} and keep the position open.`;
    weekly = WEEKLY_DEFAULT[slugHash(p.slug) % 2]!;
  }
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    { text: action, cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`, time: '15 minutes to set up' },
    { text: weekly, cost: 'about $2 of gas a week', time: '10 minutes a week' },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you sign anything, open the protocol's own site from its docs and check the address bar matches it; never follow a link from a message, a post or an ad.`,
      cost: 'nothing to check',
      time: '5 minutes',
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The protocols the board ranks, strongest first, ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot,
  // but the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol the watchlist does not name, whatever its
  // TVL. A chosen protocol stays chosen; the floor is never the whole board.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const watch = new Set(snapshot.watchlist);
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, ...v };
  });
  scored.sort((a, b) => {
    if (b.implied !== a.implied) return b.implied - a.implied;
    return a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0;
  });
  const rows: BoardRow[] = [];
  for (let i = 0; i < scored.length; i++) {
    const s = scored[i]!;
    rows.push({
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      watchlist: watch.has(s.p.slug),
      age_days: s.age,
      implied_value_usd: s.implied,
      model: {
        base_multiple: model.base_multiple,
        growth_pct: s.growthPct,
        growth_multiplier: round4(s.growthMult),
        maturity_multiplier: round4(s.maturityMult),
        chain_multiplier: round4(s.chainMult),
        age_days: s.age,
      },
      farm_steps: farmSteps(s.p, s.age).map(stepText),
    });
  }
  return rows;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.category !== 'CEX');
  live.sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd);
  return live.slice(0, LIVE_ROWS).map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd,
    change_7d: p.change_7d,
  }));
}

/** A board row's compact form for data.js; the page regenerates the farm plan from it. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    watchlist: row.watchlist,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** A required string field, or a SnapshotError naming it. */
function reqString(o: Record<string, unknown>, key: string, i: number): string {
  const v = o[key];
  if (typeof v !== 'string') throw new SnapshotError(`snapshot.json's protocol ${i} lacks ${key}`);
  return v;
}

/** An optional string field, or null. */
function optString(o: Record<string, unknown>, key: string): string | null {
  const v = o[key];
  return typeof v === 'string' ? v : null;
}

/** An optional finite number field, or null. */
function optNumber(o: Record<string, unknown>, key: string): number | null {
  const v = o[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols: SnapshotProtocol[] = [];
  for (let i = 0; i < o.protocols.length; i++) {
    const v = o.protocols[i];
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    protocols.push({
      slug: p.slug,
      name: reqString(p, 'name', i),
      category: optString(p, 'category'),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: optNumber(p, 'change_7d'),
      mcap_usd: optNumber(p, 'mcap_usd'),
      listed_at: optString(p, 'listed_at'),
      gecko_id: optString(p, 'gecko_id'),
      symbol: optString(p, 'symbol'),
    });
  }
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied
 *  value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const have = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !have.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < byRank.length; i++) {
    if (byRank[i]!.rank !== i + 1) return `rank ${i + 1} is ${byRank[i]!.rank}`;
    if (i > 0 && byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2) {
    const values = new Set(board.map((r) => r.implied_value_usd));
    if (values.size === 1) return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
