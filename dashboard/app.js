// Token Radar's dashboard: the ranked board, a detail view for every protocol,
// and the filters a farmer needs. The page renders from window.RADAR, the data
// main.ts wrote beside it; it fetches nothing and calls no network address.
//
// The page re-derives every figure it shows from the same snapshot figures the
// program used, so the board on screen and the board in board.json agree.

const DATA = window.RADAR;

/* --- pure model (mirrors lib/model.ts) --- */

const MODEL = {
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
};

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

function finite(n, fallback) { return typeof n === 'number' && Number.isFinite(n) ? n : fallback; }

function ageDays(listedAt, asOf) {
  if (listedAt === null) return null;
  const days = (Date.parse(asOf) - Date.parse(listedAt)) / 86_400_000;
  return Number.isFinite(days) ? Math.max(0, Math.floor(days)) : null;
}

/** The implied value of one row, recomputed from the snapshot's figures. */
function impliedOf(row, data) {
  const age = row.age_days ?? MODEL.unknown_age_days;
  const growthPct = clamp(finite(row.change_7d, 0), MODEL.growth_floor, MODEL.growth_cap);
  const weight = growthPct >= 0 ? MODEL.growth_weight_up : MODEL.growth_weight_down;
  const growthMult = 1 + (growthPct / 100) * weight;
  const maturityMult = MODEL.maturity_floor + (Math.min(age, MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range;
  const breadthMult = 1 + MODEL.breadth_step * Math.min(Math.max(row.chains.length - 1, 0), MODEL.breadth_cap);
  const rate = data.category_rates[row.category] ?? 0.5;
  const categoryMult = MODEL.prior_floor + MODEL.prior_range * rate;
  return {
    implied: Math.max(1, Math.round(row.tvl_usd * MODEL.base_multiple * growthMult * maturityMult * breadthMult * categoryMult)),
    growth_pct: growthPct,
    growth_mult: growthMult,
    maturity_mult: maturityMult,
    breadth_mult: breadthMult,
    category_mult: categoryMult,
    rate,
  };
}

function farmCapital(tvlUsd) {
  if (tvlUsd >= 5_000_000_000) return 250;
  if (tvlUsd >= 1_000_000_000) return 150;
  if (tvlUsd >= 100_000_000) return 100;
  return 50;
}

function holdDays(age) {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function mainAction(row, capital, chain) {
  const category = (row.category ?? '').toLowerCase();
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

function secondAction(row, secondChain) {
  const category = (row.category ?? '').toLowerCase();
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

/** The farm plan: seven steps, each with what it costs and how long it takes. */
function farmSteps(row, asOf) {
  const capital = farmCapital(row.tvl_usd);
  const age = row.age_days ?? ageDays(row.listed_at, asOf);
  const hold = holdDays(age);
  const weeks = Math.max(2, Math.round(hold / 7));
  const chain = row.chains[0] ?? 'Ethereum';
  const secondChain = row.chains.length > 1 ? (row.chains[1] ?? null) : null;
  return [
    `Set up a fresh wallet for this farm only, write its 12-word seed on paper and store it offline, and never reuse a wallet that holds other funds. Takes about 10 minutes and costs nothing.`,
    mainAction(row, capital, chain),
    secondAction(row, secondChain),
    `Repeat the qualifying action once a week for ${weeks} weeks, about $10 of new activity each time, so the address stays active across snapshots instead of going quiet. Gas about $1 a week, 5 minutes a week.`,
    `Keep the position open for at least ${hold} days; closing early can drop the address from a snapshot the team takes without warning. No extra cost, just patience.`,
    `Check the protocol's points or rewards page and its announcements once a week for a points program, a snapshot date or a token hint, and set a reminder so a short window is not missed. Free, 5 minutes a week.`,
    `When a claim opens, verify the claim link from the protocol's own announcements, claim with the farm wallet, and record the transaction hash in your farm log. Gas about $2, 10 minutes.`,
  ];
}

/* --- end pure model --- */

const $ = (id) => document.getElementById(id);
const root = $('board');

function el(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined) continue;
    if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const kid of kids.flat(9)) {
    if (kid === null || kid === undefined) continue;
    node.append(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return node;
}

const usd = (n) => n === null || n === undefined ? '—' : '$' + Math.round(n).toLocaleString('en-US');
const usdShort = (n) => {
  if (n === null || n === undefined) return '—';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(n);
};
const pct = (n) => n === null || n === undefined ? '—' : (n > 0 ? '+' : '') + n.toFixed(1) + '%';
const ageText = (days) => days === null || days === undefined ? 'Unlisted' : days < 30 ? `${days}d` : days < 365 ? `${Math.round(days / 30)}mo` : `${(days / 365).toFixed(1)}y`;
const chainsText = (chains) => chains.length === 0 ? '—' : chains.length <= 3 ? chains.join(', ') : `${chains.slice(0, 3).join(', ')} +${chains.length - 3}`;

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const tab = p.get('tab') === 'live' ? 'live' : 'pre-token';
  return {
    q: p.get('q') || '',
    category: p.get('category') || '',
    tab,
    sort: p.get('sort') || (tab === 'live' ? 'mcap' : 'implied'),
    dir: p.get('dir') === 'asc' ? 'asc' : 'desc',
    watchlist: p.get('watchlist') === '1',
    early: p.get('early') === '1',
    selected: p.get('p') || null,
  };
}

function writeHash(state) {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.category) p.set('category', state.category);
  if (state.tab !== 'pre-token') p.set('tab', state.tab);
  if (state.sort !== (state.tab === 'live' ? 'mcap' : 'implied')) p.set('sort', state.sort);
  if (state.dir !== 'desc') p.set('dir', state.dir);
  if (state.watchlist) p.set('watchlist', '1');
  if (state.early) p.set('early', '1');
  if (state.selected) p.set('p', state.selected);
  history.replaceState(null, '', `#${p.toString()}`);
}

let state = readHash();

function rowsFor(tab) {
  return tab === 'live' ? DATA.live : DATA.rows;
}

function visibleRows() {
  const q = state.q.trim().toLowerCase();
  let rows = rowsFor(state.tab);
  if (state.watchlist) rows = rows.filter((r) => r.on_watchlist);
  if (state.early) rows = rows.filter((r) => !r.on_watchlist);
  if (state.category) rows = rows.filter((r) => r.category === state.category);
  if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q) || r.category.toLowerCase().includes(q));
  const key = state.sort;
  const val = (r) => {
    if (key === 'name') return r.name.toLowerCase();
    if (key === 'tvl') return r.tvl_usd;
    if (key === 'change') return r.change_7d === null ? -Infinity : r.change_7d;
    if (key === 'age') return r.age_days === null ? -1 : r.age_days;
    if (key === 'mcap') return r.mcap_usd === null ? -1 : r.mcap_usd;
    return r.implied;
  };
  const dir = state.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = val(a);
    const vb = val(b);
    if (va < vb) return -dir;
    if (va > vb) return dir;
    return a.slug < b.slug ? -1 : 1;
  });
}

function sortButton(label, key) {
  const arrow = state.sort === key ? (state.dir === 'asc' ? ' ↑' : ' ↓') : '';
  return el('button', {
    type: 'button',
    onclick: () => {
      if (state.sort === key) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      else { state.sort = key; state.dir = key === 'name' ? 'asc' : 'desc'; }
      writeHash(state);
      render();
    },
  }, label + arrow);
}

function fact(label, value) {
  return el('div', { class: 'fact' }, el('span', { text: label }), el('b', { text: value }));
}

function chip(label, value) {
  return el('span', { class: 'chip' }, label + ' ', el('b', { text: value }));
}

function render() {
  const rows = visibleRows();
  const all = rowsFor(state.tab);
  const selected = state.selected ? all.find((r) => r.slug === state.selected) || null : null;
  const maxImplied = Math.max(1, ...DATA.rows.map((r) => r.implied));
  const categories = [...new Set(DATA.rows.map((r) => r.category))].sort();
  const median = (() => {
    const vals = [...DATA.rows.map((r) => r.implied)].sort((a, b) => a - b);
    return vals[Math.floor(vals.length / 2)];
  })();
  const fastest = DATA.rows.reduce((best, r) => (r.change_7d !== null && (best === null || r.change_7d > best.change_7d) ? r : best), null);
  const newest = DATA.rows.reduce((best, r) => (r.age_days !== null && (best === null || r.age_days < best.age_days) ? r : best), null);

  const table = el('table', {},
    el('thead', {}, el('tr', {},
      el('th', {}, sortButton('Rank', 'implied')),
      el('th', {}, sortButton('Protocol', 'name')),
      el('th', {}, sortButton(state.tab === 'live' ? 'Market cap' : 'Implied value', state.tab === 'live' ? 'mcap' : 'implied')),
      el('th', {}, sortButton('TVL', 'tvl')),
      el('th', {}, sortButton('7d', 'change')),
      el('th', {}, sortButton('Age', 'age')),
      el('th', { text: 'Status' }),
    )),
    el('tbody', {}, rows.map((r) => {
      const value = state.tab === 'live' ? (r.mcap_usd ?? 0) : r.implied;
      const change = r.change_7d;
      return el('tr', {
        'data-selected': selected && selected.slug === r.slug ? 'true' : 'false',
        onclick: () => { state.selected = r.slug; writeHash(state); render(); },
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', {}, el('span', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: `${r.category} · ${chainsText(r.chains)}` }),
        )),
        el('td', {}, el('span', { class: 'implied' },
          el('span', { class: 'num', text: usd(value) }),
          state.tab === 'live' ? null : el('span', { class: 'bar' }, el('i', { style: `width: ${Math.max(2, Math.round((value / maxImplied) * 100))}%` })),
        )),
        el('td', { class: 'num', text: usdShort(r.tvl_usd) }),
        el('td', { class: `num ${change === null ? '' : change >= 0 ? 'pos' : 'neg'}`, text: pct(change) }),
        el('td', { class: 'num', text: ageText(r.age_days) }),
        el('td', {}, state.tab === 'live'
          ? el('span', { class: 'status', text: 'Live token' })
          : el('span', {}, r.on_watchlist
            ? el('span', { class: 'badge watch', text: 'Watchlist' })
            : el('span', { class: 'badge early', text: 'Early find' })),
        ));
    })),
  );

  root.replaceChildren(el('div', { class: 'shell' },
    el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'token radar · radar-2' })),
      el('div', { class: 'top-meta' },
        el('span', { text: `Snapshot ${DATA.as_of}` }),
        el('span', { text: `${DATA.protocols} protocols` }),
        el('span', { text: `Floor ${usd(DATA.floor_usd)}` }),
      ),
    ),
    el('div', { class: 'lede' },
      el('div', {},
        el('h1', { text: 'Every pre-token protocol, ranked by what its token could be worth.' }),
        el('p', { text: 'The board ranks each protocol with no token yet by an implied value drawn from its own figures: TVL, 7-day growth, how long it has run without a token, how many chains it runs on, and how often its category has issued a token. The watchlist is the floor, never the ceiling: below it sits the early radar, the protocols the floor misses.' }),
      ),
      el('div', { class: 'facts' },
        fact('Protocols ranked', String(DATA.rows.length)),
        fact('Watchlist covered', `${DATA.watchlist_covered} of ${DATA.watchlist}`),
        fact('Early finds below the floor', String(DATA.early_size)),
        fact('Live tokens set aside', String(DATA.live_size)),
      ),
    ),
    el('div', { class: 'strip' },
      chip('Top implied', `${DATA.rows[0].name} · ${usd(DATA.rows[0].implied)}`),
      chip('Median implied', usd(median)),
      fastest ? chip('Fastest growing', `${fastest.name} · ${pct(fastest.change_7d)}`) : null,
      newest ? chip('Newest on the board', `${newest.name} · ${ageText(newest.age_days)}`) : null,
    ),
    el('div', { class: 'controls' },
      el('div', { class: 'field' },
        el('label', { for: 'q', text: 'Search' }),
        el('input', { id: 'q', type: 'search', value: state.q, placeholder: 'Name, slug or category', oninput: (e) => { state.q = e.target.value; writeHash(state); render(); } }),
      ),
      el('div', { class: 'field' },
        el('label', { for: 'cat', text: 'Category' }),
        el('select', { id: 'cat', onchange: (e) => { state.category = e.target.value; writeHash(state); render(); } },
          el('option', { value: '', text: 'All categories' }),
          categories.map((c) => el('option', { value: c, selected: state.category === c ? 'selected' : null, text: c })),
        ),
      ),
      el('div', { class: 'tabs', role: 'group', 'aria-label': 'Board' },
        el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', onclick: () => { state.tab = 'pre-token'; state.sort = 'implied'; state.dir = 'desc'; writeHash(state); render(); }, text: 'Pre-token' }),
        el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', onclick: () => { state.tab = 'live'; state.sort = 'mcap'; state.dir = 'desc'; writeHash(state); render(); }, text: 'Live token' }),
      ),
      el('div', { class: 'toggles' },
        el('button', { type: 'button', class: 'toggle', 'aria-pressed': state.watchlist ? 'true' : 'false', onclick: () => { state.watchlist = !state.watchlist; if (state.watchlist) state.early = false; writeHash(state); render(); }, text: 'Watchlist only' }),
        el('button', { type: 'button', class: 'toggle', 'aria-pressed': state.early ? 'true' : 'false', onclick: () => { state.early = !state.early; if (state.early) state.watchlist = false; writeHash(state); render(); }, text: 'Early finds only' }),
      ),
      el('span', { class: 'count', text: `${rows.length} of ${all.length} shown` }),
    ),
    el('section', { class: 'panel' },
      rows.length === 0
        ? el('div', { class: 'empty' },
            el('h2', { text: 'No protocol matches' }),
            el('p', { text: 'Loosen the search or clear the filters.' }),
            el('button', { type: 'button', class: 'button primary', onclick: () => { state.q = ''; state.category = ''; state.watchlist = false; state.early = false; writeHash(state); render(); }, text: 'Clear filters' }),
          )
        : el('div', { class: 'table-wrap' }, table),
    ),
    el('section', { class: 'panel model', 'aria-label': 'The model' },
      el('h2', { text: 'How the value is derived' }),
      el('p', { class: 'formula', text: 'implied = TVL × 0.25 × growth × maturity × breadth × category prior' }),
      el('p', { class: 'formula', text: `growth: 1 + clamped 7-day change (−60% to +120%) × 0.8 when rising, × 0.4 when falling · maturity: 0.6 + min(age, 1095 days) / 1095 × 0.4, unlisted treated as a year old · breadth: 1 + 0.04 × extra chains, up to 5 · category prior: 0.85 + 0.30 × the share of the category that already has a token, learned from this snapshot (global rate ${(DATA.global_rate * 100).toFixed(1)}%, categories under 10 protocols use the global rate)` }),
      el('p', { class: 'formula', text: 'A rise counts more than a fall of the same size: growth is a signal a launch is coming, a fall is a weaker signal of the opposite. No name is ever special-cased; the same function scores every row, and the page recomputes each row\'s value from the snapshot\'s figures.' }),
    ),
  ));

  const existing = document.querySelector('.detail');
  if (existing) existing.remove();
  if (selected) {
    const model = impliedOf(selected, DATA);
    const steps = farmSteps(selected, DATA.as_of);
    const base = selected.tvl_usd * MODEL.base_multiple;
    const why = selected.on_watchlist
      ? `Rank ${selected.rank} because it clears the $${(DATA.floor_usd / 1e6).toFixed(0)}M floor with no token, and its ${usdShort(selected.tvl_usd)} TVL, ${pct(selected.change_7d)} week and ${selected.chains.length} chain${selected.chains.length === 1 ? '' : 's'} price it at ${usd(selected.implied)}.`
      : `Rank ${selected.rank} because it sits below the $${(DATA.floor_usd / 1e6).toFixed(0)}M floor with no token, and its ${usdShort(selected.tvl_usd)} TVL, ${pct(selected.change_7d)} week and ${selected.chains.length} chain${selected.chains.length === 1 ? '' : 's'} price it at ${usd(selected.implied)} — an early find the watchlist misses.`;
    const dialog = el('dialog', { class: 'detail', open: true },
      el('div', { class: 'detail-head' },
        el('div', {},
          el('span', { class: 'sub', text: `Rank ${selected.rank} · ${selected.category} · ${chainsText(selected.chains)}` }),
          el('h2', { text: selected.name }),
          el('p', { class: 'sub', text: `${usd(selected.tvl_usd)} TVL · ${pct(selected.change_7d)} in 7 days · ${ageText(selected.age_days)} old · ${selected.on_watchlist ? 'on the watchlist' : 'an early find below the floor'}` }),
        ),
        el('button', { type: 'button', class: 'close', onclick: () => { state.selected = null; writeHash(state); render(); }, text: 'Close' }),
      ),
      el('section', { class: 'detail-section' },
        el('h3', { text: 'Why this value' }),
        el('div', { class: 'equation' },
          el('div', {}, el('span', { text: 'Base · TVL × 0.25' }), el('b', { text: usd(base) })),
          el('div', {}, el('span', { text: `Growth · ${model.growth_pct.toFixed(1)}% × ${model.growth_pct >= 0 ? '0.8' : '0.4'}` }), el('b', { text: `×${model.growth_mult.toFixed(3)}` })),
          el('div', {}, el('span', { text: `Maturity · ${selected.age_days === null ? 'unlisted, treated as 365 days' : `${selected.age_days} days`}` }), el('b', { text: `×${model.maturity_mult.toFixed(3)}` })),
          el('div', {}, el('span', { text: `Breadth · ${selected.chains.length} chain${selected.chains.length === 1 ? '' : 's'}` }), el('b', { text: `×${model.breadth_mult.toFixed(3)}` })),
          el('div', {}, el('span', { text: `Category prior · ${selected.category} token rate ${(model.rate * 100).toFixed(1)}%` }), el('b', { text: `×${model.category_mult.toFixed(3)}` })),
          el('div', {}, el('span', { text: 'Implied value' }), el('b', { text: usd(selected.implied) })),
        ),
        el('p', { class: 'why', text: why }),
      ),
      el('section', { class: 'detail-section' },
        el('h3', { text: 'How to farm it' }),
        el('ol', { class: 'steps' }, steps.map((s) => {
          const first = s.indexOf('. ');
          const head = first > 0 ? s.slice(0, first) : s;
          const rest = first > 0 ? s.slice(first + 2) : '';
          return el('li', {}, el('b', { text: head + '.' }), el('span', { class: 'cost', text: rest }));
        })),
      ),
    );
    document.body.append(dialog);
  }
}

if (!DATA || !Array.isArray(DATA.rows)) {
  root.replaceChildren(el('div', { class: 'shell' }, el('p', { text: 'The radar data did not load. Serve the output directory and open dashboard/index.html again.' })));
} else {
  const bad = DATA.rows.filter((r) => impliedOf(r, DATA).implied !== r.implied);
  if (bad.length > 0) console.warn(`token radar: ${bad.length} rows disagree with the page model`);
  render();
}
