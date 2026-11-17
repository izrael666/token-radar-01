// Token Radar's night dashboard. It reads window.RADAR (written beside dashboard/ by main.ts)
// and shows the ranked board, a filterable table, and a per-protocol detail view with the model's
// own inputs and the protocol's farm plan. No network: every byte it shows is in data.js.
//
// The farm plan and the implied value are recomputed here from the same figures main.ts used, so
// the page and the board are visibly the same arithmetic. The plan comes from a rule table keyed
// by category, never by name: the same table the model runs, ported to this page.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', watchOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFmt.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The model, recomputed in the page: the same function main.ts ran, so the number the page
  // shows for a row is the number board.json carries for it.
  function impliedOf(row, model) {
    var change = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, change));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var chains = row.chains && row.chains.length ? row.chains.length : 0;
    var chainMult = 1 + model.chain_step * Math.min(Math.max(chains - 1, 0), model.chain_max_extra);
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * chainMult));
  }

  // A tiny element builder: h('div', {class: 'x'}, 'text', childNode, [more...]).
  function h(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      });
    }
    function put(child) {
      if (child === null || child === undefined || child === false) return;
      if (Array.isArray(child)) { child.forEach(put); return; }
      if (typeof child === 'string') { node.appendChild(document.createTextNode(child)); return; }
      node.appendChild(child);
    }
    for (var i = 2; i < arguments.length; i++) put(arguments[i]);
    return node;
  }

  // The farm plan, from the same rule table the model runs: the first rule whose words appear in
  // the category wins. Ported line for line from lib/model.ts, so the page and the board agree.
  var WEEKLY_DEFAULT = [
    'Make one qualifying action, such as a deposit, a borrow, a swap or a vote.',
    'Use the protocol once, in the way its own docs describe as activity.'
  ];
  var FARM_RULES = [
    { keys: ['lend', 'cdp', 'collateral'],
      action: function (name, capital, chain) { return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.'; },
      weekly: ['Borrow a small amount against the supply once, then repay it the same week.', 'Top the supply up by a few dollars and leave the position open.'] },
    { keys: ['dex', 'yield', 'leveraged farm', 'liquidity manager', 'farm'],
      action: function (name, capital, chain) { return 'Provide $' + capital + " of liquidity to " + name + "'s main pool on " + chain + ' and keep the position open.'; },
      weekly: ['Swap a small amount through the pool so the position shows trading activity.', 'Add a few dollars of liquidity and claim any fees the pool paid.'] },
    { keys: ['bridge', 'cross chain'],
      action: function (name, capital, chain) { return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.'; },
      weekly: ['Bridge a small amount back and forth so both sides of the route are used.', 'Use the bridged funds in one app on the destination chain.'] },
    { keys: ['staking', 'restak', 'anchor btc', 'decentralized btc'],
      action: function (name, capital, chain) { return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.'; },
      weekly: ['Restake the rewards the position earned instead of withdrawing them.', 'Check the staking receipt and keep it in the same wallet.'] },
    { keys: ['perpetual', 'derivative', 'basis trading'],
      action: function (name, capital, chain) { return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.'; },
      weekly: ['Close the hedge and open a fresh one at a smaller size.', 'Adjust the margin by a few dollars and keep the position open.'] },
    { keys: ['prediction'],
      action: function (name, capital) { return 'Fund $' + capital + ' and place one market position on ' + name + '.'; },
      weekly: ['Settle one market and open a fresh position on another.', 'Vote on one market outcome with a small stake.'] },
    { keys: ['curator', 'allocator'],
      action: function (name, capital, chain) { return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.'; },
      weekly: ['Move a few dollars between the vaults the curator offers.', 'Check the vault allocation and rebalance a small amount.'] },
    { keys: ['rwa'],
      action: function (name, capital, chain) { return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.'; },
      weekly: WEEKLY_DEFAULT },
    { keys: ['stable'],
      action: function (name, capital, chain) { return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.'; },
      weekly: WEEKLY_DEFAULT },
    { keys: ['insurance'],
      action: function (name, capital, chain) { return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.'; },
      weekly: WEEKLY_DEFAULT },
    { keys: ['index'],
      action: function (name, capital, chain) { return 'Buy $' + capital + ' of the ' + name + ' index on ' + chain + ' and hold the shares.'; },
      weekly: WEEKLY_DEFAULT },
    { keys: ['payment', 'card issuer'],
      action: function (name, capital) { return 'Order the ' + name + ' card, load $' + capital + ' onto it and spend from it once a week.'; },
      weekly: WEEKLY_DEFAULT },
    { keys: ['governance'],
      action: function (name, capital, chain) { return 'Lock $' + capital + ' of the governance asset in ' + name + ' on ' + chain + ' and vote on one proposal.'; },
      weekly: WEEKLY_DEFAULT },
    { keys: ['otc'],
      action: function (name, capital, chain) { return 'Request a $' + capital + ' quote on ' + name + ' and settle one trade on ' + chain + '.'; },
      weekly: WEEKLY_DEFAULT },
    { keys: ['cedefi'],
      action: function (name, capital, chain) { return 'Deposit $' + capital + ' of USDC into the ' + name + ' vault on ' + chain + ' and keep the shares.'; },
      weekly: WEEKLY_DEFAULT }
  ];
  function ruleFor(category) {
    var c = (category || '').toLowerCase();
    for (var i = 0; i < FARM_RULES.length; i++) {
      var keys = FARM_RULES[i].keys;
      for (var j = 0; j < keys.length; j++) if (c.indexOf(keys[j]) >= 0) return FARM_RULES[i];
    }
    return null;
  }
  function slugHash(slug) {
    var hash = 0;
    for (var i = 0; i < slug.length; i++) hash = (hash * 31 + slug.charCodeAt(i)) >>> 0;
    return hash;
  }
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 90) return 90;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var rule = ruleFor(p.category);
    var action, weekly;
    if (rule) {
      action = rule.action(p.name, capital, chain);
      weekly = rule.weekly[slugHash(p.slug) % 2];
    } else if ((p.category || '').toLowerCase() === 'chain') {
      action = 'Bridge $' + capital + ' of USDC to ' + chain + ' and use one of its apps through ' + p.name + ' every week.';
      weekly = WEEKLY_DEFAULT[slugHash(p.slug) % 2];
    } else {
      action = 'Deposit $' + capital + ' of USDC into ' + p.name + ' on ' + chain + ' and keep the position open.';
      weekly = WEEKLY_DEFAULT[slugHash(p.slug) % 2];
    }
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: action, cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: weekly, cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you sign anything, open the protocol's own site from its docs and check the address bar matches it; never follow a link from a message, a post or an ad.", cost: 'nothing to check', time: '5 minutes' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  // The address bar carries the view: search, category, chain, watchlist-only and the open protocol.
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('watch') === '1') state.watchOnly = true;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchOnly) params.set('watch', '1');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // The rows the filters leave, then sorted by the chosen key.
  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchOnly && !r.watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortRows(list) {
    var key = state.sort;
    function val(r) {
      if (key === 'name') return r.name.toLowerCase();
      if (key === 'tvl') return r.tvl_usd;
      if (key === 'growth') return r.change_7d === null ? -Infinity : r.change_7d;
      if (key === 'age') return r.age_days === null ? Infinity : r.age_days;
      return r.implied_value_usd;
    }
    return list.slice().sort(function (a, b) {
      var av = val(a), bv = val(b);
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function topBar() {
    return h('header', { class: 'top' },
      h('div', { class: 'brand' }, h('span', { class: 'mark' }), h('span', { class: 'brand-name', text: 'Token Radar' })),
      h('div', { class: 'top-meta' },
        h('span', { text: 'Snapshot ' + DATA.as_of }),
        h('span', { text: 'DefiLlama protocol index' }),
        h('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return h('section', { class: 'lede' },
      h('div', null,
        h('h1', { text: 'Every pre-token protocol, ranked by what its launch would be worth' }),
        h('p', { html: 'The watchlist is the floor: <b>' + DATA.watchlist_size + ' protocols</b> with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds <b>' + DATA.early_size + ' more</b> below it, down to the smallest pre-token protocol the snapshot carries. Implied value is a model, not a promise.' })
      ),
      h('div', { class: 'facts' },
        h('div', { class: 'fact' }, h('span', { text: 'Watchlist covered' }), h('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        h('div', { class: 'fact' }, h('span', { text: 'Pre-token rows scored' }), h('b', { text: String(DATA.board_size) })),
        h('div', { class: 'fact' }, h('span', { text: 'Early rows beyond the watchlist' }), h('b', { text: String(DATA.early_size) })),
        h('div', { class: 'fact' }, h('span', { text: 'Live-token protocols set aside' }), h('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function optionList(values, current, allLabel) {
    return [h('option', { value: 'all', text: allLabel })].concat(values.map(function (v) {
      return h('option', { value: v, text: v, selected: v === current ? 'selected' : null });
    }));
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = h('input', { type: 'search', id: 'q', placeholder: 'Search a name, a category or a chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = h('select', { id: 'category', 'aria-label': 'Filter by category' }, optionList(categories, state.category, 'All categories'));
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var chain = h('select', { id: 'chain', 'aria-label': 'Filter by chain' }, optionList(chains, state.chain, 'All chains'));
    chain.addEventListener('change', function () { state.chain = chain.value; writeHash(); render(); });
    var watch = h('input', { type: 'checkbox', id: 'watch', checked: state.watchOnly ? 'checked' : null, 'aria-label': 'Watchlist only' });
    watch.addEventListener('change', function () { state.watchOnly = watch.checked; writeHash(); render(); });
    function tab(label, name) {
      return h('button', { type: 'button', 'aria-pressed': state.tab === name ? 'true' : 'false', text: label, onclick: function () { state.tab = name; render(); } });
    }
    return h('div', { class: 'controls' },
      h('div', { class: 'field' }, h('label', { for: 'q', text: 'Search' }), search),
      h('div', { class: 'field' }, h('label', { for: 'category', text: 'Category' }), cat),
      h('div', { class: 'field' }, h('label', { for: 'chain', text: 'Chain' }), chain),
      h('label', { class: 'check' }, watch, 'Watchlist only'),
      h('div', { class: 'field' }, h('span', { class: 'sub', text: 'Token status' }), h('div', { class: 'tabs' }, tab('Pre-token', 'pre-token'), tab('Live token', 'live'))),
      h('span', { class: 'count', text: state.tab === 'pre-token' ? visibleRows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortCell(key, label) {
    return h('th', { scope: 'col' },
      h('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? h('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function protocolCell(r) {
    var tag = r.watchlist
      ? h('span', { class: 'tag watch', text: 'Watchlist' })
      : h('span', { class: 'tag early', text: 'Early' });
    var where = (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain');
    if (r.chains && r.chains.length > 2) where += ' +' + (r.chains.length - 2);
    return h('td', null,
      h('div', { class: 'name' }, h('span', null, h('b', { text: r.name }), tag), h('span', { class: 'sub', text: where }))
    );
  }

  function boardTable() {
    var list = sortRows(visibleRows());
    if (list.length === 0) {
      return h('div', { class: 'panel' }, h('div', { class: 'empty' },
        h('h2', { text: 'Nothing matches that filter' }),
        h('p', { text: 'Clear the search or choose another category to bring the board back.' }),
        h('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchOnly = false; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = h('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = h('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        h('td', { class: 'num', text: String(r.rank) }),
        protocolCell(r),
        h('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        h('td', { class: 'num ' + growthClass, text: growth }),
        h('td', { class: 'num', text: fmtAge(r.age_days) }),
        h('td', null, h('div', { class: 'implied' },
          h('div', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          h('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        h('td', null, h('span', { class: 'status pre', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return h('div', { class: 'panel' },
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Open a row for its model and farm plan.' }),
          h('thead', null, h('tr', null,
            sortCell('implied', 'Rank'),
            sortCell('name', 'Protocol'),
            sortCell('tvl', 'TVL'),
            sortCell('growth', '7d'),
            sortCell('age', 'Age'),
            sortCell('implied', 'Implied value'),
            h('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = h('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(h('tr', null,
        h('td', { class: 'num', text: 'live' }),
        h('td', null, h('div', { class: 'name' }, h('b', { text: r.name }), h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        h('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        h('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        h('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        h('td', null, h('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return h('div', { class: 'panel' },
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'sub', text: 'Already trading: these protocols have a token, so their market cap is a fact, not a model. They sit apart from the pre-token ranking.' }),
          h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Status' }), h('th', { scope: 'col', text: 'Protocol' }), h('th', { scope: 'col', text: 'TVL' }), h('th', { scope: 'col', text: '7d' }), h('th', { scope: 'col', text: 'Market cap' }), h('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return h('section', { class: 'panel model' },
      h('h2', { text: 'How the model prices a launch' }),
      h('p', { class: 'sub', text: 'One function scores every row from the snapshot figures. No name is special-cased and no row is hand-picked.' }),
      h('div', { class: 'formula' },
        'implied = round( tvl_usd x ' + m.base_multiple + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + ' + m.chain_step + ' x min(chains - 1, ' + m.chain_max_extra + ')) )'
      ),
      h('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Chains count its distribution: a protocol live on several chains reaches more wallets than one on a single chain. The board carries every rankable pre-token protocol, watchlist or not, and the live-token protocols are set aside with their market caps shown.' }),
      h('p', { class: 'sub', text: 'A protocol is called pre-token because its record carries no token, not because it has none: a record may simply not carry a token it already has. Implied value is the model\u2019s claim about a launch, never a price and never a promise that a token comes.' })
    );
  }

  var dialog = h('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = null;
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) { row = DATA.rows[i]; break; }
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
    dialog.appendChild(h('div', { class: 'detail-head' },
      h('div', null,
        h('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' · Watchlist' : ' · Early') }),
        h('h2', { id: 'detail-title', text: row.name }),
        h('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      h('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    function fact(label, value, total) {
      return h('div', null, h('span', { text: label }), h('b', { class: total ? 'num total' : 'num', text: value }));
    }
    dialog.appendChild(h('section', { class: 'detail-section' },
      h('h3', { text: 'Implied value' }),
      h('div', { class: 'equation' },
        fact('TVL', fmtUsd(row.tvl_usd)),
        fact('Seven-day growth', fmtPct(row.change_7d)),
        fact('Age with no token', fmtAge(row.age_days)),
        fact('Chains', String(row.chains ? row.chains.length : 0)),
        fact('Growth multiplier', String(row.growth_multiplier)),
        fact('Maturity multiplier', String(row.maturity_multiplier)),
        fact('Chain multiplier', String(row.chain_multiplier)),
        fact('Implied value', fmtUsd(row.implied_value_usd), true)
      ),
      h('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(h('section', { class: 'detail-section' },
      h('h3', { text: 'Farm plan' }),
      h('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return h('li', null, h('b', { text: action }), h('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = h('div', { class: 'shell' });
    shell.appendChild(topBar());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
