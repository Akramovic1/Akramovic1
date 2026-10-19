// Collects GitHub activity (public + private, as far as STATS_TOKEN can see) and
// renders assets/stats-{light,dark}.svg plus assets/stats.json.
//
//   STATS_TOKEN=... node scripts/stats.mjs          fetch + render
//   node scripts/stats.mjs --from assets/stats.json re-render only (no network)
//
// Zero dependencies; Node 20+.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const OUT = new URL('../assets/', import.meta.url);
const API = 'https://api.github.com';
const TOKEN = process.env.STATS_TOKEN || process.env.GITHUB_TOKEN;

const W = 960;
// Org memberships are private, so the API cannot list them; keep them here.
const ORGS = [['FuzeXLabs', 'Fuze X Labs'], ['Ferru-io', 'Ferru'], ['Cusp-bio', 'Cusp.bio'], ['Bleui-ai', 'Bleui.ai']];
const SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",Helvetica,Arial,sans-serif';
const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace';
const THEMES = {
  light: { fg: '#0d1117', muted: '#57606a', faint: '#d0d7de', accent: '#6d28d9', ramp: ['#6d28d9', '#24292f', '#57606a', '#8c959f', '#afb8c1', '#d0d7de'] },
  dark: { fg: '#f0f6fc', muted: '#8b949e', faint: '#30363d', accent: '#a78bfa', ramp: ['#a78bfa', '#f0f6fc', '#c9d1d9', '#8b949e', '#6e7681', '#30363d'] },
};

// ---------- fetch ----------

async function gh(path, init = {}) {
  const res = await fetch(path.startsWith('http') ? path : API + path, {
    ...init,
    headers: { authorization: `bearer ${TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'profile-stats', ...init.headers },
  });
  // Actions logs on a public repo are public: never print private repo paths or response bodies.
  if (!res.ok && res.status !== 202 && res.status !== 204) throw new Error(`GitHub API ${res.status} on ${path.replace(/\/repos\/[^/]+\/[^/]+/, '/repos/<redacted>')}`);
  return res;
}

async function gql(query, variables = {}) {
  const res = await gh('/graphql', { method: 'POST', body: JSON.stringify({ query, variables }) });
  const body = await res.json();
  if (body.errors) throw new Error(`GraphQL error: ${body.errors.map((e) => e.type || 'UNKNOWN').join(', ')}`);
  return body.data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pool(items, size, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

// Contributions come from the public calendar, the same numbers the profile page shows
// (private contributions included as counts when that profile setting is on). The GraphQL
// contributionsCollection undercounts private work for fine-grained tokens.
async function calendar(login, from, to) {
  const q = from ? `?from=${from}&to=${to}` : '';
  const res = await fetch(`https://github.com/users/${login}/contributions${q}`, { headers: { 'user-agent': 'profile-stats' } });
  if (!res.ok) throw new Error(`calendar ${res.status}`);
  const html = await res.text();
  const cells = {};
  for (const m of html.matchAll(/<td\b[^>]*>/g)) {
    const date = m[0].match(/data-date="([^"]+)"/)?.[1], id = m[0].match(/\bid="([^"]+)"/)?.[1], week = m[0].match(/data-ix="(\d+)"/)?.[1];
    if (date && id) cells[id] = { date, week: Number(week), count: 0 };
  }
  for (const m of html.matchAll(/<tool-tip\b[^>]*for="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g)) {
    const n = m[2].match(/^([\d,]+) contributions? on/);
    if (cells[m[1]] && n) cells[m[1]].count = Number(n[1].replace(/,/g, ''));
  }
  const days = Object.values(cells);
  if (!days.length) throw new Error('calendar: no days parsed');
  return days;
}

const REPOS_Q = `query($after:String){viewer{repositories(first:100,after:$after,ownerAffiliations:[OWNER,ORGANIZATION_MEMBER,COLLABORATOR]){
  pageInfo{hasNextPage endCursor}
  nodes{nameWithOwner isFork isPrivate owner{login}
    languages(first:20,orderBy:{field:SIZE,direction:DESC}){edges{size node{name}}}}}}}`;

// Avatars are inlined as data URIs: an SVG shown through <img> cannot load external images.
async function orgAvatars() {
  return Promise.all(ORGS.map(async ([login, name]) => {
    const res = await fetch(`https://github.com/${login}.png?size=64`, { headers: { 'user-agent': 'profile-stats' } });
    if (!res.ok) throw new Error(`avatar ${res.status}`);
    const type = res.headers.get('content-type') || 'image/png';
    return { login, name, avatar: `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}` };
  }));
}

async function collect() {
  if (!TOKEN) throw new Error('Set STATS_TOKEN (see README of this repo).');
  const { viewer } = await gql('{viewer{login createdAt}}');
  const login = viewer.login;
  const now = new Date();

  // All-time contributions, one calendar year at a time.
  let contributions = 0;
  for (let y = new Date(viewer.createdAt).getUTCFullYear(); y <= now.getUTCFullYear(); y++) {
    contributions += (await calendar(login, `${y}-01-01`, `${y}-12-31`)).reduce((t, d) => t + d.count, 0);
  }

  // Rolling last 12 months, for the weekly strip.
  const lastDays = await calendar(login);
  const weeks = [];
  for (const d of lastDays) weeks[d.week] = (weeks[d.week] || 0) + d.count;
  const lastYear = lastDays.reduce((t, d) => t + d.count, 0);
  const activeDays = lastDays.filter((d) => d.count > 0).length;

  // Repositories (own + orgs + collaborations), languages by bytes over non-fork repos you own.
  const repos = [];
  for (let after = null; ;) {
    const page = (await gql(REPOS_Q, { after })).viewer.repositories;
    repos.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }
  const owned = repos.filter((r) => r.owner.login === login);
  const langs = {};
  for (const r of owned.filter((r) => !r.isFork)) {
    // Notebooks are mostly stored cell output, not code.
    for (const e of r.languages.edges) if (e.node.name !== 'Jupyter Notebook') langs[e.node.name] = (langs[e.node.name] || 0) + e.size;
  }

  // Commits and lines added / removed by you, from each repo's contributor statistics
  // (these see private repos the token can read, unlike contributionsCollection).
  let additions = 0, deletions = 0, commits = 0, activeRepos = 0, skipped = 0;
  await pool(repos.filter((r) => !r.isFork), 4, async (r) => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const res = await gh(`/repos/${r.nameWithOwner}/stats/contributors`);
      if (res.status === 204) return;
      if (res.status === 202) { await sleep(3000 + attempt * 2000); continue; } // GitHub is computing the stats
      const me = (await res.json()).find((c) => c.author?.login === login);
      if (me) {
        commits += me.total;
        activeRepos++;
        for (const w of me.weeks) { additions += w.a; deletions += w.d; }
      }
      return;
    }
    skipped++;
  });
  if (skipped) console.warn(`line stats not ready for ${skipped} repositories, skipped`);

  return {
    login, since: new Date(viewer.createdAt).getUTCFullYear(), updated: now.toISOString().slice(0, 10),
    contributions, commits, activeRepos, additions, deletions,
    lastYear, activeDays, weeks: Array.from(weeks, (w) => w || 0),
    repositories: owned.length, privateRepositories: owned.filter((r) => r.isPrivate).length,
    languages: Object.entries(langs).sort((a, b) => b[1] - a[1]),
    orgs: await orgAvatars(),
  };
}

// ---------- render ----------

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const compact = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e5 ? `${Math.round(n / 1e3)}k` : n.toLocaleString('en-US');
const full = (n) => n.toLocaleString('en-US');

function render(s, t) {
  const c = THEMES[t];
  const orgs = s.orgs || [];
  const H = orgs.length ? 420 : 330;
  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">`,
    `<title id="t">GitHub activity</title>`,
    `<desc id="d">${esc(`${full(s.contributions)} contributions since ${s.since}, ${full(s.additions)} lines added, ${full(s.commits)} commits, ${s.repositories} repositories including ${s.privateRepositories} private.`)}</desc>`,
    `<style>`,
    `.n{font:650 46px/1 ${SANS};letter-spacing:-1.6px;fill:${c.fg}}`,
    `.l{font:500 12px/1 ${MONO};letter-spacing:1.8px;fill:${c.muted}}`,
    `.s{font:400 14px/1 ${SANS};fill:${c.muted}}`,
    `.g{font:500 12px/1 ${MONO};fill:${c.muted}}`,
    `.bar{fill:${c.faint};transform-box:fill-box;transform-origin:bottom;animation:up .9s cubic-bezier(.2,.8,.2,1) both}`,
    `.top{fill:${c.accent}}`,
    `.o{font:500 12px/1 ${MONO};letter-spacing:1.6px;fill:${c.fg}}`,
    `@keyframes up{from{transform:scaleY(0)}}`,
    `@media (prefers-reduced-motion:reduce){.bar{animation:none}}`,
    `</style>`);

  // Four headline numbers.
  const cols = [
    ['CONTRIBUTIONS', compact(s.contributions), `since ${s.since}`],
    ['LINES ADDED', compact(s.additions), `${compact(s.deletions)} removed`],
    ['COMMITS', compact(s.commits), `across ${s.activeRepos} repositories`],
    ['REPOSITORIES', String(s.repositories), `${s.privateRepositories} private`],
  ];
  cols.forEach(([label, value, sub], i) => {
    const x = i * 240;
    if (i) o.push(`<rect x="${x - 20}" y="0" width="1" height="96" fill="${c.faint}"/>`);
    o.push(`<text class="l" x="${x}" y="12">${label}</text>`,
      `<text class="n" x="${x - 2}" y="66">${esc(value)}</text>`,
      `<text class="s" x="${x}" y="94">${esc(sub)}</text>`);
  });

  // Weekly contributions over the last 12 months.
  o.push(`<text class="l" x="0" y="146">LAST 12 MONTHS</text>`,
    `<text class="l" x="${W}" y="146" text-anchor="end">${esc(`${full(s.lastYear)} CONTRIBUTIONS · ${s.activeDays} ACTIVE DAYS`)}</text>`);
  const max = Math.max(1, ...s.weeks), gap = 4, bw = (W - gap * (s.weeks.length - 1)) / s.weeks.length;
  const top = [...s.weeks].sort((a, b) => b - a)[Math.min(4, s.weeks.length - 1)];
  s.weeks.forEach((v, i) => {
    // Log scale: a few huge weeks must not flatten every ordinary week to nothing.
    const h = v ? 6 + (Math.log1p(v) / Math.log1p(max)) * 70 : 2;
    o.push(`<rect class="bar${v >= top && v > 0 ? ' top' : ''}" x="${(i * (bw + gap)).toFixed(1)}" y="${(240 - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" style="animation-delay:${(i * 12)}ms"/>`);
  });

  // Languages by bytes.
  const totalBytes = s.languages.reduce((a, [, b]) => a + b, 0) || 1;
  const shown = s.languages.slice(0, 5);
  const rest = totalBytes - shown.reduce((a, [, b]) => a + b, 0);
  const segs = rest > 0 ? [...shown, ['Other', rest]] : shown;
  o.push(`<text class="l" x="0" y="280">LANGUAGES</text>`);

  // Organizations: greyscale avatar + mono name in a hairline chip.
  if (orgs.length) {
    o.push(`<defs><filter id="mono"><feColorMatrix type="saturate" values="0"/></filter></defs>`,
      `<text class="l" x="0" y="372">ORGANIZATIONS</text>`);
    let cx = 0;
    orgs.forEach((g, i) => {
      const label = g.name.toUpperCase();
      const w = 40 + label.length * 9;
      o.push(`<rect x="${cx + 0.5}" y="386.5" width="${w}" height="27" rx="6" fill="none" stroke="${c.faint}"/>`,
        `<clipPath id="av${i}"><rect x="${cx + 8}" y="392" width="16" height="16" rx="3"/></clipPath>`,
        `<image href="${g.avatar}" x="${cx + 8}" y="392" width="16" height="16" clip-path="url(#av${i})" filter="url(#mono)"/>`,
        `<text class="o" x="${cx + 32}" y="404.5">${esc(label)}</text>`);
      cx += w + 10;
    });
  }
  let x = 0;
  const legend = [];
  segs.forEach(([name, bytes], i) => {
    const w = (bytes / totalBytes) * W;
    o.push(`<rect x="${x.toFixed(1)}" y="292" width="${Math.max(0, w - 2).toFixed(1)}" height="6" rx="1" fill="${c.ramp[i]}"/>`);
    legend.push(`${name} ${Math.round((bytes / totalBytes) * 100)}%`);
    x += w;
  });
  o.push(`<text class="g" x="0" y="322">${esc(legend.join('  ·  '))}</text>`,
    `<text class="g" x="${W}" y="${orgs.length ? 404 : 322}" text-anchor="end">${esc(`PUBLIC + PRIVATE · ${s.updated}`)}</text>`,
    `</svg>`);
  return o.join('\n') + '\n';
}

// ---------- main ----------

const fromIdx = process.argv.indexOf('--from');
const stats = fromIdx > -1 ? JSON.parse(await readFile(process.argv[fromIdx + 1], 'utf8')) : await collect();
await mkdir(OUT, { recursive: true });
if (fromIdx === -1) await writeFile(new URL('stats.json', OUT), JSON.stringify(stats, null, 2) + '\n');
for (const t of Object.keys(THEMES)) await writeFile(new URL(`stats-${t}.svg`, OUT), render(stats, t));
console.log(`rendered stats for ${stats.login}: ${stats.contributions} contributions, +${stats.additions}/-${stats.deletions} lines`);
