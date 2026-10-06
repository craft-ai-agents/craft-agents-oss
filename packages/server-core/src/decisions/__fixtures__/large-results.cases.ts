/**
 * Synthetic large tool results for `scripts/decisions-eval.ts --feature large_results`:
 * made-up data shaped like real results (Slack search, issue lists, logs, documents), with
 * the markers of the parts the intent needs. No user data. Deterministic.
 */

export interface LargeResultCase {
  name: string
  intent: string
  text: string
  /** Substrings marking the items the intent needs. */
  relevant: string[]
  /** `summarize` when nothing or nearly everything is relevant. */
  expect: 'filter' | 'summarize'
}

const pick = <T>(items: readonly T[], i: number): T => items[i % items.length]!

const CHATTER = [
  'Standup: finished the migration review, picking up the flaky test next.',
  'Reminder that the office is closed on Monday, plan your deploys accordingly.',
  'Anyone have context on why the nightly export took twice as long yesterday?',
  'Pushed a fix for the tooltip overlap on the settings page, needs a second review.',
  'Lunch order is in, the vegetarian option is the curry this week.',
  'The odds feed for NHL preseason games is lagging by about 40 seconds, looking into it.',
  'Customer support asked for a macro about delayed withdrawals, drafting one now.',
  'Retro notes are in the doc, top theme was too many late scope changes.',
  'MLB tab analytics: engagement up 12% week over week after the redesign.',
  'Please do not merge to main until the release branch is cut tonight.',
]

const slackSearch = (texts: string[]) => JSON.stringify({
  ok: true,
  query: 'in:#product-launches after:2026-09-01',
  messages: {
    total: texts.length,
    pagination: { total_count: texts.length, page: 1, per_page: 100, page_count: 1, first: 1, last: texts.length },
    matches: texts.map((text, i) => ({
      iid: `iid-${i}`,
      team: 'T0001',
      channel: { id: 'C0LAUNCH', name: 'product-launches', is_private: false },
      type: 'message',
      user: pick(['U01ANA', 'U02BEN', 'U03CHO', 'U04DAN'], i),
      username: pick(['ana', 'ben', 'cho', 'dan'], i),
      ts: `${1_759_000_000 + i * 3_600}.000100`,
      text,
      permalink: `https://example.slack.com/archives/C0LAUNCH/p${1_759_000_000 + i * 3_600}000100`,
      reactions: i % 3 === 0 ? [{ name: 'eyes', count: 2 }] : [],
    })),
  },
  users: { U01ANA: { name: 'ana' }, U02BEN: { name: 'ben' }, U03CHO: { name: 'cho' }, U04DAN: { name: 'dan' } },
})

const launchMessages = Array.from({ length: 40 }, (_, i) => {
  if (i === 7) return 'Heads up: the NHL tab launch moves from Oct 2 to Oct 9 so it lands with the opening night promo. Product confirmed in the planning sync.'
  if (i === 21) return 'Confirming for the record: NHL tab launch date is Oct 9, signed off by Dan (product) and Cho (eng).'
  if (i === 33) return 'Marketing copy for the NHL tab launch on Oct 9 is approved, assets go live with the release.'
  return `${pick(CHATTER, i)} (${i})`
})

const issues = Array.from({ length: 30 }, (_, i) => {
  const login = [4, 15, 26].includes(i)
  return {
    number: 4100 + i,
    title: login
      ? pick(['Users cannot log in after password reset', 'SSO users get a blank page and cannot log in', 'Cannot log in on Safari 18: session cookie dropped'], [4, 15, 26].indexOf(i))
      : pick(['Chart tooltip overlaps legend', 'Export to CSV drops the last row', 'Typo in onboarding email', 'Slow query on market search', 'Dark mode contrast on badges', 'Flaky test in settlement worker'], i),
    state: i % 7 === 0 ? 'closed' : 'open',
    labels: login ? ['bug', 'auth'] : [pick(['bug', 'enhancement', 'chore'], i)],
    body: login
      ? 'Several users report they cannot log in. Steps: reset password, sign in again, get redirected back to the sign-in page. Started after the last auth deploy.'
      : 'Repro steps and screenshots attached. Low impact, can wait for the next sprint unless someone is already in that area of the code.',
    comments: i % 4,
  }
})

const deployLog = [
  ...Array.from({ length: 170 }, (_, i) => `2026-09-30T18:${String(10 + Math.floor(i / 6)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}Z INFO  ${pick(['Pulling image registry/app:7f3c2e1', 'Running migration 0042_add_market_index ... ok', 'Health check /healthz returned 200', 'Uploading static assets to CDN (512 files)', 'Warming cache for 1,204 markets', 'Scaling web from 3 to 5 replicas'], i)} [step ${i}]`),
  '2026-09-30T18:39:02Z ERROR Deploy failed: container web-5 exited with code 1 during startup',
  '2026-09-30T18:39:02Z ERROR Error: Missing required environment variable PAYMENTS_WEBHOOK_SECRET',
  '    at loadConfig (/app/dist/config.js:88:13)',
  '    at bootstrap (/app/dist/main.js:12:5)',
  '2026-09-30T18:39:03Z ERROR Caused by: secret payments/webhook not mounted in namespace staging',
  ...Array.from({ length: 120 }, (_, i) => `2026-09-30T18:${String(40 + Math.floor(i / 6)).padStart(2, '0')}:${String((i * 11) % 60).padStart(2, '0')}Z INFO  ${pick(['Rolling back to previous release 7e1d9a0', 'Draining connections on web-4', 'Health check /healthz returned 200', 'Notifying #deploys channel', 'Cleaning up temporary volumes'], i)} [rollback ${i}]`),
].join('\n')

const SECTIONS = ['Shipping times', 'International orders', 'Returns of unused items', 'Exchanges', 'Gift cards', 'Warranty claims', 'Price adjustments', 'Order tracking', 'Damaged deliveries', 'Privacy and data', 'Loyalty points']
const policyDoc = ['# Customer policies', '', 'Last updated September 2026. This page collects the policies support agents quote most often.', '',
  ...SECTIONS.flatMap((section, i) => {
    const block = [`## ${section}`, '', `${section} follow the standard process described here. ${'Agents should check the order status, confirm the customer identity, and note the ticket number before making any change. Escalate anything unusual to a team lead. '.repeat(3)}`, '']
    return i === 4
      ? [...block, '## Refunds for cancelled orders', '', 'Refunds for cancelled orders: if a customer cancels before the order ships, refund the full amount to the original payment method within 3 business days. If it already shipped, the customer returns it first and we refund on receipt, minus the shipping fee. Card refunds take up to 10 days to appear.', '']
      : block
  })].join('\n')

const events = {
  kind: 'calendar#events',
  summary: 'Work',
  items: Array.from({ length: 50 }, (_, i) => {
    const design = [9, 23, 31, 44].includes(i)
    return {
      id: `evt${i}`,
      status: 'confirmed',
      summary: design ? pick(['Design review: onboarding flow', 'Design team sync', 'Design critique: market page', 'Design x Eng handoff'], [9, 23, 31, 44].indexOf(i)) : pick(['1:1 with manager', 'Sprint planning', 'Focus time', 'Incident review', 'Lunch', 'All hands', 'Hiring loop: backend'], i),
      start: { dateTime: `2026-10-${String(1 + Math.floor(i / 5)).padStart(2, '0')}T${String(9 + (i % 8)).padStart(2, '0')}:00:00-04:00` },
      end: { dateTime: `2026-10-${String(1 + Math.floor(i / 5)).padStart(2, '0')}T${String(10 + (i % 8)).padStart(2, '0')}:00:00-04:00` },
      attendees: design ? [{ email: 'design-team@example.com' }, { email: 'me@example.com' }] : [{ email: 'me@example.com' }, { email: `colleague${i}@example.com` }],
      description: design ? 'Walk through the latest mocks with the design team.' : 'Agenda in the linked doc.',
    }
  }),
}

const markets = Array.from({ length: 60 }, (_, i) => {
  const league = pick(['nba', 'nhl', 'nfl', 'mlb', 'nba'], i)
  const closesToday = league === 'nba' && i % 3 === 0
  const teams = pick(['lakers-celtics', 'knicks-heat', 'bulls-bucks', 'suns-warriors', 'nuggets-mavs'], i)
  const date = closesToday ? '2026-10-01' : pick(['2026-10-03', '2026-10-05', '2026-10-01'], i + 1)
  return { slug: `${league}-${teams}-${date}-${i}`, title: `${league.toUpperCase()}: ${teams.replace('-', ' vs ')}`, league, closesAt: `${date}T23:00:00Z`, volume: 1000 * (i + 3), outcomes: ['Home', 'Away'] }
})
const nbaToday = markets.filter(m => m.league === 'nba' && m.closesAt.startsWith('2026-10-01')).map(m => m.slug)

const rotation = ['# Platform on-call', '', 'How on-call works: one primary and one secondary per week, handover Monday 10:00 ET.', '',
  ...['July', 'August', 'September'].flatMap(month => [`## ${month} rotation`, '', ...[1, 2, 3, 4].map(week => `- Week ${week} of ${month}: primary ${pick(['ana', 'ben', 'cho', 'dan'], week)}, secondary ${pick(['eve', 'fay', 'gus', 'hal'], week + month.length)}`), '', `Notes for ${month}: ${'Swaps must be recorded in the pager tool and announced in #oncall at least two days ahead. '.repeat(4)}`, '']),
  '## October rotation', '', '- Week 1 of October: primary ben, secondary eve', '- Week 2 of October: primary cho, secondary fay', '- Week 3 of October: primary dan, secondary gus', '- Week 4 of October: primary ana, secondary hal', '',
  ...['Escalation policy', 'Runbooks', 'Paging etiquette', 'Compensation'].flatMap(section => [`## ${section}`, '', `${'Follow the documented process and keep the incident channel updated every 30 minutes while an incident is open. '.repeat(5)}`, '']),
].join('\n')

export const LARGE_RESULT_CASES: LargeResultCase[] = [
  { name: 'slack-search-launch-date', intent: 'Find when the NHL tab launch date was decided and who confirmed it.', text: slackSearch(launchMessages), relevant: ['moves from Oct 2 to Oct 9', 'Confirming for the record'], expect: 'filter' },
  { name: 'slack-no-match', intent: "Find mentions of Project Falcon's budget.", text: slackSearch(launchMessages.map((text, i) => ([7, 21, 33].includes(i) ? pick(CHATTER, i) : text))), relevant: [], expect: 'summarize' },
  { name: 'github-login-issues', intent: 'Find open issues about users failing to log in.', text: JSON.stringify(issues), relevant: ['cannot log in', 'Cannot log in'], expect: 'filter' },
  { name: 'deploy-log-error', intent: 'Find the error that made the staging deploy fail.', text: deployLog, relevant: ['ERROR', 'Caused by'], expect: 'filter' },
  { name: 'policy-refunds', intent: 'What is the refund policy when a customer cancels an order?', text: policyDoc, relevant: ['Refunds for cancelled orders'], expect: 'filter' },
  { name: 'calendar-design', intent: 'Find meetings with the design team next week.', text: JSON.stringify(events), relevant: ['design-team@example.com'], expect: 'filter' },
  { name: 'markets-nba-today', intent: 'Find NBA markets that close today, 2026-10-01.', text: JSON.stringify(markets), relevant: nbaToday, expect: 'filter' },
  { name: 'oncall-october', intent: 'Who is on call in the second week of October?', text: rotation, relevant: ['Week 2 of October'], expect: 'filter' },
]
