# Telegram Integration Test Suite

Comprehensive test coverage for all Telegram integration improvements.

## Test Files

### 1. `deduplication.test.ts` (10 tests)
Tests for message deduplication system to prevent duplicate event processing.

**Coverage:**
- First message allowance
- Duplicate blocking by updateId
- Duplicate blocking by chatId:messageId fallback
- Different message allowance
- Cache size tracking
- Cache clearing
- TTL expiration (structure verification)
- High volume handling (3000+ messages)
- Same message with different updateIds
- Zero updateId handling

**Key Features Tested:**
- 10-minute TTL for deduplication
- MAX_CACHE_SIZE of 2000 with automatic pruning
- Dual-key system (updateId + chatId:messageId)
- Edge case: node-telegram-bot-api scenarios

### 2. `account-manager.test.ts` (8 tests)
Tests for multi-account architecture support.

**Coverage:**
- Default account configuration
- Account retrieval by ID
- Enabled accounts filtering
- Default account creation
- Account existence checks
- Empty account handling

**Key Features Tested:**
- Multi-account configuration structure
- Account enable/disable state
- Default account fallback
- Account isolation

### 3. `debounce.test.ts` (12 tests)
Tests for inbound message debouncing to combine rapid sequential messages.

**Coverage:**
- Single message flushing after window
- Rapid message combining from same user
- Different user message isolation
- Different chat message isolation
- Command immediate flushing (skip debounce)
- Attachment immediate flushing (skip debounce)
- Timer reset on new message
- Burst typing scenario (5 messages)
- Double newline message combining
- Cleanup timer clearing
- Multiple simultaneous chats
- Message order preservation

**Key Features Tested:**
- 1.5s debounce window (configurable)
- User+chat key isolation
- Command/media skip logic
- Timer reset mechanism

### 4. `retry.test.ts` (26 tests)
Tests for exponential backoff and retry logic.

**Coverage:**

#### Backoff Computation (5 tests)
- Exponential growth calculation
- Max delay capping
- Jitter variance (±25%)
- Default policy values
- Non-negative delay guarantee

#### Retry Mechanism (6 tests)
- First attempt success
- Transient failure retry
- Max attempts exhaustion
- shouldRetry predicate respect
- Inter-attempt delays
- Default policy usage

#### Telegram Error Classification (10 tests)
- 400/401/403/404 no-retry
- 429 rate limit retry
- 500/503 server error retry
- Network error retry
- Timeout error retry
- Unknown error retry (default)
- Non-Error object retry
- Case-insensitive matching

#### Integration (3 tests)
- Client error immediate fail
- Server error retry up to max
- Transient error recovery

**Key Features Tested:**
- Exponential backoff: base * factor^(attempt-1)
- Jitter: ±25% randomization
- Max delay: 30 seconds
- Max attempts: 5
- Smart error categorization

### 5. `access-control.test.ts` (25 tests)
Tests for access control policies and allowlists.

**Coverage:**

#### DM Access (9 tests)
- Disabled policy blocks all
- Open policy allows all
- Allowlist policy user filtering
- Non-allowlisted user blocking
- Pairing mode allowlisted users
- Pairing code generation
- Different pairing codes per user
- Pairing code format (PAIR-{last4}-{random})
- Empty allowlist handling

#### Group Access (12 tests)
- Disabled policy blocks all
- Open policy allows all
- Group+user allowlist combined check
- Group not allowlisted blocking
- User not allowlisted blocking
- Empty allowedGroups (all allowed)
- Empty allowedUsers (all allowed)
- Empty both (all allowed)
- Group-specific blocking
- User-specific blocking

#### Integration Scenarios (4 tests)
- Mixed DM/group access
- Different DM/group policies
- Pairing mode workflow
- Negative chat/user IDs (Telegram groups)

**Key Features Tested:**
- DM policies: disabled, pairing, allowlist, open
- Group policies: disabled, allowlist, open
- Pairing code generation (PAIR-{userId}-{random})
- Allowlist intersection logic

### 6. `integration.test.ts` (23 tests)
End-to-end integration tests combining all features.

**Coverage:**

#### Deduplication + Debouncing (2 tests)
- Dedupe before debounce
- Debounce non-duplicate rapid messages

#### Access Control + Mention Gating (4 tests)
- DM access check before processing
- Group access + mention gating combined
- Group message with mention allowed
- Commands in groups without mention

#### Echo Tracking (2 tests)
- Own message skipping
- Echo expiration after TTL

#### Retry + Error Handling (2 tests)
- Transient error retry
- Client error no-retry

#### Multi-Account (3 tests)
- Separate state per account
- Different access policies per account
- Different mention requirements per account

#### Complete Pipeline (3 tests)
- Valid message full pipeline
- Pipeline rejection at each stage
- Group message with mention pipeline

#### Edge Cases (3 tests)
- Rapid duplicate spam handling
- Multiple concurrent chats
- Commands with immediate flush + dedup

#### Performance (3 tests)
- High volume (3000+ messages) memory management
- Concurrent access control checks
- Echo tracker load handling

**Key Features Tested:**
- Full message processing pipeline
- Multi-layer security (echo → dedup → access → mention → debounce)
- Multi-account isolation
- Performance and scalability
- Edge case robustness

## Running Tests

```bash
# Run all Telegram tests
bun test packages/shared/src/telegram/

# Run specific test suite
bun test packages/shared/src/telegram/__tests__/debounce.test.ts
bun test packages/shared/src/telegram/__tests__/retry.test.ts
bun test packages/shared/src/telegram/__tests__/access-control.test.ts
bun test packages/shared/src/telegram/__tests__/integration.test.ts

# Run with watch mode
bun test --watch packages/shared/src/telegram/
```

## Test Statistics

- **Total Tests:** 104 tests
- **Total Expect Calls:** 207 assertions
- **Test Files:** 6 files
- **Execution Time:** ~2.7 seconds

## Coverage Summary

| Feature | Unit Tests | Integration Tests | Total |
|---------|------------|-------------------|-------|
| Deduplication | 10 | 4 | 14 |
| Multi-Account | 8 | 3 | 11 |
| Debouncing | 12 | 2 | 14 |
| Retry Logic | 26 | 2 | 28 |
| Access Control | 25 | 4 | 29 |
| Echo Tracking | - | 2 | 2 |
| Mention Gating | - | 4 | 4 |
| Full Pipeline | - | 3 | 3 |

## Test Quality

- **Deterministic:** All tests are deterministic and don't require actual Telegram connections
- **Fast:** Average 26ms per test
- **Isolated:** No shared state between tests
- **Comprehensive:** Covers happy paths, edge cases, and error scenarios
- **Realistic:** Uses realistic message structures and scenarios
- **Performance:** Includes load testing for memory management

## Continuous Integration

All tests pass on:
- Bun v1.3.5
- Node.js (via Bun compatibility)
- macOS (Darwin 24.6.0)

## Future Test Additions

Potential areas for future test expansion:
- Reconnection loop automated tests (currently manual)
- Typing indicator timing tests
- Reaction level tests (off/ack/minimal/extensive)
- Attachment handling (when implemented)
- Rate limiting edge cases
- Long-running session continuity
