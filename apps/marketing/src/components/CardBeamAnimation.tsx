import { useEffect, useRef, useCallback, useState } from 'react'
import { codeToHtml } from 'shiki'
import { ScannerBeam } from './ScannerBeam'
import './card-beam.css'

/**
 * Claude Code CLI-style conversation snippets.
 * Simulates the terminal output of Claude Code interactions.
 */
const CODE_SNIPPETS = [
  `> Add a dark mode toggle to the settings page

I'll add a dark mode toggle to the settings. Let me first
check the existing theme implementation.

Read src/theme/ThemeProvider.tsx
Read src/components/Settings.tsx

I found the theme context. I'll add a toggle component
that switches between light and dark modes.

Edit src/components/Settings.tsx
  + import { useTheme } from '../theme/ThemeProvider'
  +
  + export function Settings() {
  +   const { theme, setTheme } = useTheme()
  +   return (
  +     <Toggle
  +       checked={theme === 'dark'}
  +       onChange={() => setTheme(
  +         theme === 'dark' ? 'light' : 'dark'
  +       )}
  +     />
  +   )
  + }

Done. The dark mode toggle is now available in Settings.`,

  `> Fix the authentication bug in the login flow

I'll investigate the authentication issue. Let me search
for the relevant code.

Grep "authenticate" --type ts
Found 12 matches in 4 files

Read src/auth/AuthProvider.tsx

I see the issue - the token refresh isn't being awaited
properly, causing a race condition.

Edit src/auth/AuthProvider.tsx
  - const token = refreshToken()
  + const token = await refreshToken()

The fix ensures the token is refreshed before continuing.
Let me verify by running the tests.

Bash npm test -- auth
✓ All 8 tests passed

The authentication bug is fixed.`,

  `> Create a new API endpoint for user preferences

I'll create a new endpoint for managing user preferences.

Write src/api/preferences.ts
  export async function getPreferences(userId: string) {
    const prefs = await db.preferences.findUnique({
      where: { userId }
    })
    return prefs ?? DEFAULT_PREFERENCES
  }

  export async function updatePreferences(
    userId: string,
    updates: Partial<Preferences>
  ) {
    return db.preferences.upsert({
      where: { userId },
      update: updates,
      create: { userId, ...DEFAULT_PREFERENCES, ...updates }
    })
  }

Edit src/api/routes.ts
  + router.get('/preferences', getPreferences)
  + router.put('/preferences', updatePreferences)

The preferences API is ready to use.`,

  `> Refactor the component to use React Query

I'll refactor the data fetching to use React Query for
better caching and state management.

Read src/components/UserList.tsx

Edit src/components/UserList.tsx
  - const [users, setUsers] = useState([])
  - const [loading, setLoading] = useState(true)
  -
  - useEffect(() => {
  -   fetchUsers().then(setUsers).finally(() =>
  -     setLoading(false)
  -   )
  - }, [])
  + const { data: users, isLoading } = useQuery({
  +   queryKey: ['users'],
  +   queryFn: fetchUsers,
  + })

Much cleaner! React Query handles loading states,
caching, and refetching automatically.`,

  `> Set up the database schema for the new feature

I'll create the database schema for the notification
system.

Write prisma/migrations/add_notifications.sql
  CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    body TEXT,
    read_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE INDEX idx_notifications_user
    ON notifications(user_id, created_at DESC);

Bash npx prisma migrate dev
Migration applied successfully

The notifications table is ready.`,

  `> Help me understand how the caching works

Let me explain the caching architecture in this codebase.

Read src/cache/CacheManager.ts
Read src/cache/strategies.ts

The caching system uses a multi-layer approach:

1. **L1 Cache**: In-memory LRU cache for hot data
   - 1000 item limit, 5 minute TTL
   - Used for frequently accessed resources

2. **L2 Cache**: Redis for distributed caching
   - Shared across all instances
   - 1 hour default TTL

3. **Invalidation**: Event-driven cache busting
   - Publishes to Redis pub/sub on mutations
   - All instances invalidate simultaneously

The \`@Cached\` decorator makes it easy to cache any method.`,

  `> Deploy the application to production

I'll help you deploy to production. Let me check the
current configuration.

Read .env.production
Read docker-compose.prod.yml

Everything looks configured. Running the deployment:

Bash docker compose -f docker-compose.prod.yml build
Building app image... done
Building nginx image... done

Bash docker compose -f docker-compose.prod.yml up -d
Creating network "app_default"... done
Creating app_db_1... done
Creating app_redis_1... done
Creating app_api_1... done
Creating app_nginx_1... done

Bash curl -s https://api.example.com/health
{"status":"healthy","version":"2.1.0"}

Deployment successful! The app is live.`,

  `> Write tests for the payment processing module

I'll write comprehensive tests for the payment module.

Write src/payments/__tests__/processor.test.ts
  describe('PaymentProcessor', () => {
    it('processes valid card payments', async () => {
      const result = await processor.charge({
        amount: 1000,
        currency: 'usd',
        source: 'tok_visa'
      })
      expect(result.status).toBe('succeeded')
    })

    it('handles declined cards gracefully', async () => {
      const result = await processor.charge({
        amount: 1000,
        currency: 'usd',
        source: 'tok_declined'
      })
      expect(result.status).toBe('failed')
      expect(result.error).toBe('card_declined')
    })

    it('validates amount limits', async () => {
      await expect(processor.charge({
        amount: -100,
        currency: 'usd'
      })).rejects.toThrow('Invalid amount')
    })
  })

Bash npm test payments
✓ 3 tests passed`,

  `> Optimize the database queries

I'll analyze and optimize the slow queries.

Bash npm run db:analyze
Analyzing query performance...

Found 3 slow queries:
1. getUserWithPosts - 450ms avg
2. getRecentActivity - 380ms avg
3. searchUsers - 290ms avg

Read src/db/queries/users.ts

The N+1 query problem is causing the slowdown.

Edit src/db/queries/users.ts
  - const user = await db.user.findUnique({ where: { id } })
  - const posts = await db.post.findMany({
  -   where: { authorId: id }
  - })
  + const user = await db.user.findUnique({
  +   where: { id },
  +   include: { posts: true }
  + })

Bash npm run db:analyze
getUserWithPosts - 45ms avg (10x faster!)

Query optimization complete.`,

  `> Set up CI/CD pipeline

I'll configure GitHub Actions for CI/CD.

Write .github/workflows/ci.yml
  name: CI/CD
  on: [push, pull_request]

  jobs:
    test:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
        - run: npm ci
        - run: npm test
        - run: npm run lint

    deploy:
      needs: test
      if: github.ref == 'refs/heads/main'
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - run: npm ci && npm run build
        - uses: aws-actions/configure-aws-credentials@v4
        - run: aws s3 sync dist/ s3://\${{ secrets.BUCKET }}

Pipeline configured! Push to main to trigger deployment.`,
]

/**
 * Document-style summaries of the code snippets.
 * More prose/commentary, less code - like a summary or report.
 */
const DOCUMENT_SNIPPETS = [
  {
    title: 'Dark Mode Toggle',
    content: `Added a theme toggle component to the Settings page that switches between light and dark modes.

The implementation uses the existing <code>ThemeProvider</code> context, making it consistent with the app's theme architecture.

<strong>Changes made:</strong>
<ul>
<li>Imported useTheme hook from ThemeProvider</li>
<li>Added Toggle component with theme state binding</li>
<li>Toggle automatically persists preference</li>
</ul>`,
  },
  {
    title: 'Auth Bug Fix',
    content: `Fixed a race condition in the authentication flow where token refresh wasn't being awaited properly.

<strong>Root cause:</strong> The <code>refreshToken()</code> call was missing <code>await</code>, causing subsequent requests to use stale tokens.

<strong>Resolution:</strong> Added proper async/await handling. All 8 authentication tests now pass.`,
  },
  {
    title: 'Preferences API',
    content: `Created new REST endpoints for managing user preferences with automatic defaults.

<strong>Endpoints:</strong>
<ul>
<li><code>GET /preferences</code> - Retrieve user prefs</li>
<li><code>PUT /preferences</code> - Update user prefs</li>
</ul>

Uses upsert pattern to handle both new and existing users seamlessly.`,
  },
  {
    title: 'React Query Migration',
    content: `Refactored data fetching from manual useState/useEffect to React Query for better state management.

<strong>Benefits:</strong>
<ul>
<li>Automatic caching and deduplication</li>
<li>Built-in loading and error states</li>
<li>Background refetching</li>
<li>Cleaner, more declarative code</li>
</ul>`,
  },
  {
    title: 'Notifications Schema',
    content: `Created database schema for the notification system with optimized indexing.

<strong>Table structure:</strong> UUID primary key, user reference, type, title, body, read status, and timestamps.

<strong>Performance:</strong> Added composite index on <code>(user_id, created_at)</code> for efficient user notification queries.`,
  },
  {
    title: 'Caching Architecture',
    content: `The caching system uses a multi-layer approach:

<strong>L1 Cache:</strong> In-memory LRU with 1000 item limit and 5 minute TTL for hot data.

<strong>L2 Cache:</strong> Redis for distributed caching across instances with 1 hour default TTL.

<strong>Invalidation:</strong> Event-driven via Redis pub/sub ensures all instances stay synchronized.`,
  },
  {
    title: 'Production Deploy',
    content: `Successfully deployed application to production using Docker Compose.

<strong>Services started:</strong>
<ul>
<li>PostgreSQL database</li>
<li>Redis cache</li>
<li>API server</li>
<li>Nginx reverse proxy</li>
</ul>

Health check confirmed: <code>v2.1.0</code> is live.`,
  },
  {
    title: 'Payment Tests',
    content: `Wrote comprehensive test suite for the payment processing module.

<strong>Test coverage:</strong>
<ul>
<li>Valid card payments succeed</li>
<li>Declined cards handled gracefully</li>
<li>Amount validation enforced</li>
</ul>

All 3 tests passing with proper error handling.`,
  },
  {
    title: 'Query Optimization',
    content: `Resolved N+1 query problem causing slow database performance.

<strong>Before:</strong> <code>getUserWithPosts</code> averaged 450ms due to separate queries for user and posts.

<strong>After:</strong> Using Prisma <code>include</code> for eager loading - now 45ms average. <strong>10x improvement!</strong>`,
  },
  {
    title: 'CI/CD Pipeline',
    content: `Configured GitHub Actions for continuous integration and deployment.

<strong>Test job:</strong> Runs on every push and PR - installs deps, runs tests and linting.

<strong>Deploy job:</strong> Triggers on main branch after tests pass - builds and syncs to S3.`,
  },
]

interface CardData {
  id: number
  codeHtml: string // Shiki-highlighted HTML for code side
  docHtml: string // Document HTML for clean side
}

/**
 * Post-process Shiki HTML to add diff highlighting classes.
 * Looks for lines containing + or - prefixes and adds .line-add or .line-remove classes.
 */
function addDiffHighlighting(html: string): string {
  // Shiki wraps each line in <span class="line">...</span>
  // We need to add .line-add or .line-remove based on content
  // Using [\s\S]*? instead of .*? to match across potential line breaks in HTML
  return html.replace(/<span class="line">([\s\S]*?)<\/span>/g, (match, content) => {
    // Check if line content starts with + or - (possibly after whitespace/spans)
    // Strip HTML tags to check the actual text content
    const textContent = content.replace(/<[^>]*>/g, '')
    const trimmed = textContent.trim()

    // Match diff-style lines: "  + code" or "  - code" (with leading whitespace)
    // Exclude lines that are just symbols like "+++" or "---"
    if (trimmed.startsWith('+') && !trimmed.startsWith('++')) {
      return `<span class="line line-add">${content}</span>`
    } else if (trimmed.startsWith('-') && !trimmed.startsWith('--')) {
      return `<span class="line line-remove">${content}</span>`
    }
    return match
  })
}

/**
 * CardBeamAnimation - Evervault-inspired horizontal card animation
 *
 * Cards scroll from left to right. On the left side, cards display syntax-highlighted code.
 * As they pass through the center beam, they transform into clean white cards on the right.
 *
 * Transformation direction: code (left) -> clean card (right)
 */
export function CardBeamAnimation() {
  const containerRef = useRef<HTMLDivElement>(null)
  const cardLineRef = useRef<HTMLDivElement>(null)
  const [cards, setCards] = useState<CardData[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Animation state refs (mutable, don't trigger re-renders)
  const positionRef = useRef(0)
  const velocityRef = useRef(80) // pixels per second
  const directionRef = useRef(1) // 1 = moving right (left to right flow)
  const lastTimeRef = useRef(0)
  const animationFrameRef = useRef<number>()
  const containerWidthRef = useRef(0)
  const cardLineWidthRef = useRef(0)

  // Card dimensions
  const CARD_WIDTH = 400
  const CARD_GAP = 60
  const CARD_COUNT = 20

  // Initialize cards with Shiki-highlighted code
  useEffect(() => {
    async function highlightCode() {
      const highlightedCards: CardData[] = []

      for (let i = 0; i < CARD_COUNT; i++) {
        // Cycle through code snippets — modulo indices are always in range.
        const codeSnippet = CODE_SNIPPETS[i % CODE_SNIPPETS.length]!
        const docSnippet = DOCUMENT_SNIPPETS[i % DOCUMENT_SNIPPETS.length]!

        // Highlight with Shiki using a dark terminal-like theme
        const rawHtml = await codeToHtml(codeSnippet, {
          lang: 'markdown',
          theme: 'vitesse-dark',
        })

        // Post-process to add diff highlighting (red/green backgrounds for +/- lines)
        const codeHtml = addDiffHighlighting(rawHtml)

        // Build document HTML with title and content
        const docHtml = `<h3 class="doc-title">${docSnippet.title}</h3><div class="doc-body">${docSnippet.content}</div>`

        highlightedCards.push({ id: i, codeHtml, docHtml })
      }

      setCards(highlightedCards)
      setIsLoading(false)
    }

    highlightCode()
  }, [])

  // Calculate container dimensions
  const calculateDimensions = useCallback(() => {
    if (containerRef.current) {
      containerWidthRef.current = containerRef.current.offsetWidth
    }
    cardLineWidthRef.current = (CARD_WIDTH + CARD_GAP) * CARD_COUNT
  }, [])

  // Update card clipping based on position relative to beam
  const updateCardClipping = useCallback(() => {
    if (!cardLineRef.current) return

    const scannerX = window.innerWidth / 2
    const scannerWidth = 2 // Match the 2px beam
    const scannerLeft = scannerX - scannerWidth / 2
    const scannerRight = scannerX + scannerWidth / 2

    const wrappers = cardLineRef.current.querySelectorAll('.card-wrapper')
    wrappers.forEach((wrapper) => {
      const rect = wrapper.getBoundingClientRect()
      const cardLeft = rect.left
      const cardRight = rect.right
      const cardWidth = rect.width

      const cleanCard = wrapper.querySelector('.card-clean') as HTMLElement
      const codeCard = wrapper.querySelector('.card-code') as HTMLElement

      if (!cleanCard || !codeCard) return

      // Card intersects with scanner beam
      if (cardLeft < scannerRight && cardRight > scannerLeft) {
        // LEFT-TO-RIGHT flow: penetration from the right side of card
        // How much of the card has passed through (is to the right of beam)
        const penetration = Math.min(cardRight - scannerLeft, cardWidth)
        const penetrationPercent = (penetration / cardWidth) * 100

        // LEFT-TO-RIGHT transformation (code on left → clean on right):
        // - Clean card clips from LEFT: 100% (hidden) → 0% (visible) as card passes right
        // - Code clips from RIGHT: 0% (visible) → 100% (hidden) as card passes right
        const cleanClipLeft = 100 - penetrationPercent
        const codeClipRight = penetrationPercent

        cleanCard.style.setProperty('--clip-left', `${cleanClipLeft}%`)
        codeCard.style.setProperty('--clip-right', `${codeClipRight}%`)
      } else {
        // Card fully on one side of scanner
        if (cardLeft > scannerRight) {
          // Card has passed through (right of beam) - show clean card fully
          cleanCard.style.setProperty('--clip-left', '0%')
          codeCard.style.setProperty('--clip-right', '100%')
        } else if (cardRight < scannerLeft) {
          // Card not yet passed (left of beam) - show code fully
          cleanCard.style.setProperty('--clip-left', '100%')
          codeCard.style.setProperty('--clip-right', '0%')
        }
      }
    })
  }, [])

  // Update card line position with seamless looping
  const updateCardPosition = useCallback(() => {
    if (!cardLineRef.current) return

    const cardLineWidth = cardLineWidthRef.current

    // Seamless loop for LEFT-TO-RIGHT flow:
    // Position increases as cards move right. Reset when one full set has scrolled.
    if (positionRef.current >= 0) {
      positionRef.current -= cardLineWidth
    } else if (positionRef.current < -cardLineWidth) {
      positionRef.current += cardLineWidth
    }

    cardLineRef.current.style.transform = `translateX(${positionRef.current}px)`
    updateCardClipping()
  }, [updateCardClipping])

  // Main animation loop
  const animate = useCallback(() => {
    const currentTime = performance.now()
    const deltaTime = (currentTime - lastTimeRef.current) / 1000
    lastTimeRef.current = currentTime

    // Update position based on velocity and direction
    positionRef.current += velocityRef.current * directionRef.current * deltaTime
    updateCardPosition()

    animationFrameRef.current = requestAnimationFrame(animate)
  }, [updateCardPosition])

  // Initialize animation
  useEffect(() => {
    calculateDimensions()

    // Start position: center cards around the beam
    // Position so some cards are already visible on both sides
    const totalWidth = (CARD_WIDTH + CARD_GAP) * CARD_COUNT
    // Start at a negative offset so cards are visible from the start
    positionRef.current = -(totalWidth / 2) + (window.innerWidth / 2)
    // Ensure position is within valid loop range
    while (positionRef.current > 0) {
      positionRef.current -= totalWidth
    }
    lastTimeRef.current = performance.now()

    animationFrameRef.current = requestAnimationFrame(animate)

    const handleResize = () => {
      calculateDimensions()
    }
    window.addEventListener('resize', handleResize)

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      window.removeEventListener('resize', handleResize)
    }
  }, [animate, calculateDimensions])

  if (isLoading) {
    return <div className="card-beam-container" />
  }

  return (
    <div className="card-beam-container" ref={containerRef}>
      {/* Scanner beam - simple CSS vertical gradient line */}
      <ScannerBeam />

      {/* Card stream - render cards twice for seamless infinite loop */}
      <div className="card-stream">
        <div className="card-line" ref={cardLineRef}>
          {/* First set of cards */}
          {cards.map((card) => (
            <div key={card.id} className="card-wrapper">
              {/* Clean card - revealed after passing through beam */}
              <div className="card card-clean">
                <div className="card-content">
                  {/* Placeholder - user will add images later */}
                </div>
              </div>

              {/* Code overlay - Shiki highlighted, visible before passing through beam */}
              <div className="card card-code">
                <div
                  className="code-content"
                  dangerouslySetInnerHTML={{ __html: card.codeHtml }}
                />
              </div>
            </div>
          ))}
          {/* Duplicate set for seamless looping */}
          {cards.map((card) => (
            <div key={`dup-${card.id}`} className="card-wrapper">
              <div className="card card-clean">
                <div className="card-content" />
              </div>
              <div className="card card-code">
                <div
                  className="code-content"
                  dangerouslySetInnerHTML={{ __html: card.codeHtml }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
