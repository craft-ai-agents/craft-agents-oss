---
status: pending
priority: p1
issue_id: AGEMENT-003
tags: [code-review, legal, compliance, agentation]
dependencies: []
blockedBy: []
blocks: []
created: 2026-01-23
updated: 2026-01-23
---

# Agentation: License Verification Required (PolyForm Shield)

## Problem Statement

The Agentation package (`agentation@1.1.0`) is licensed under **PolyForm Shield 1.0.0**, a proprietary license with specific usage restrictions. The license includes a non-compete clause that must be reviewed for compatibility with Vesper's distribution model and business strategy.

**Why it matters:**
- **Legal compliance:** Cannot merge or ship without legal approval
- **Business risk:** Non-compete clause may restrict Vesper's product direction
- **IP protection:** Using proprietary code without review creates liability
- **Distribution:** May affect open-source distribution rights

## Findings

**Location:** Package metadata in `apps/electron/package.json`

**Package Details:**
- Name: `agentation`
- Version: `1.1.0`
- License: `PolyForm-Shield-1.0.0`
- Maintainer: Benji Taylor (benjitaylor@benji.co)
- Repository: Likely proprietary (not on GitHub)
- Status: Actively maintained

**License Text (Summary):**
```
PolyForm Shield 1.0.0

1. Grant of Rights
Licensor grants you a nonexclusive, royalty-free, worldwide,
revocable license to use this software.

2. Limitations
You may not provide the software as a service.
You may not compete with Licensor regarding this software or
any product or service that includes Agentation.
```

**Key Restrictions:**
- ❌ Cannot re-sell Agentation as standalone product
- ❌ Cannot create competing debug panel without license
- ❌ Cannot restrict Licensor's ability to license others
- ⚠️ Non-compete clause may affect Vesper's future feature roadmap
- ✅ Can use in Vesper's internal product
- ✅ Can distribute as part of Vesper

**Risk Assessment:**
- **Severity:** MEDIUM-HIGH (requires legal review)
- **Timeline:** Blocking feature until cleared
- **Owner:** Legal/Compliance team
- **Effort:** 1-3 business days for legal review

## Proposed Solutions

### Solution A: Get Legal Clearance (RECOMMENDED)
**Effort:** 1-3 days | **Risk:** Low | **Complexity:** Low

Submit license for legal review:

1. **Request:** Provide legal team with:
   - Agentation package.json
   - PolyForm Shield 1.0.0 license text
   - Use case: Debug panel in Vesper (proprietary desktop app)
   - Distribution: Ship as part of Vesper desktop app

2. **Legal Review:** Team evaluates:
   - Does non-compete clause restrict Vesper?
   - Are usage restrictions acceptable?
   - Any other compliance issues?

3. **Decision:** Three possible outcomes:
   - ✅ **Approved:** Proceed with implementation
   - ⚠️ **Approved with conditions:** Implement per legal guidance
   - ❌ **Rejected:** Remove package, find alternative

**Pros:**
- Ensures legal compliance
- Prevents future issues
- Clear audit trail
- Professional approach

**Cons:**
- 1-3 day delay
- Possible rejection requiring rework

### Solution B: Replace with Open-Source Alternative
**Effort:** 2-4 hours | **Risk:** Medium | **Complexity:** Medium

If legal rejects, alternatives exist:

**Option 1: Build Custom Debug Panel**
- Pros: Full control, no license issues
- Cons: 4-8 hours engineering time

**Option 2: Use React DevTools**
- Pros: Free, open-source, well-maintained
- Cons: Generic, not agent-specific

**Option 3: Integrate Claude Debugger**
- Pros: Anthropic-native, optimized for Claude
- Cons: May require SDK integration

**Pros (B2):**
- Complete legal freedom
- No external dependencies

**Cons (B2):**
- More engineering effort
- Delays feature

### Solution C: Defer Feature, Get Approval Later
**Effort:** Minimal | **Risk:** Low | **Complexity:** Low

Remove Agentation for now, plan for later:

1. Remove package from `package.json`
2. Remove IPC handlers and config
3. Ship feature in next release pending legal clearance
4. Get legal approval in parallel

**Pros:**
- Doesn't block other features
- Can revisit after legal review

**Cons:**
- Delays feature launch
- Extra refactoring work now

## Recommended Action

**IMPLEMENT: Solution A (Get Legal Clearance)**

The PolyForm Shield license is not prohibitive—it's designed for tools like this. Legal review should be straightforward. Don't block progress until confirmed incompatible.

**Timeline:**
1. **Today:** Submit license to legal team with use case
2. **Tomorrow/Next day:** Legal reviews and provides guidance
3. **After approval:** Proceed with engineering fixes

## Technical Details

**License File Location:**
- Installed at: `node_modules/agentation/package.json`
- License text: `node_modules/agentation/LICENSE`

**Files Affected:**
- `apps/electron/package.json` (dependency)
- Potentially: `CONTRIBUTING.md`, `LICENSE` (if attribution needed)

**No code changes required** (pending legal approval).

## Acceptance Criteria

- [ ] Legal team reviews PolyForm Shield 1.0.0 license
- [ ] Legal team reviews Agentation use case (debug panel in Vesper)
- [ ] Legal decision: Approved, Approved with Conditions, or Rejected
- [ ] If approved: Document decision and add to CONTRIBUTING.md
- [ ] If conditions: Implement per legal guidance
- [ ] If rejected: Create follow-up todo for alternative approach

## Work Log

- **2026-01-23 10:15** - Issue identified during security review
- **2026-01-23 10:18** - License text analyzed
- **Pending** - Legal review submission

## Related Issues

- None (independent)

## Resources

- PolyForm Shield 1.0.0: https://polyformproject.org/licenses/shield/1.0.0/
- Agentation package: https://www.npmjs.com/package/agentation
- Agentation license in repo: Check `node_modules/agentation/LICENSE`
- Code review security analysis: `AGENTATION_SECURITY_REVIEW.md` section 1.3

## Legal Review Template

**For Legal Team:**

```markdown
## License Compliance Review Request

**Package:** agentation v1.1.0
**License:** PolyForm Shield 1.0.0
**Use Case:** Debug panel in Vesper desktop application

**Questions:**
1. Are there legal restrictions on using this package in Vesper?
2. Does the non-compete clause restrict Vesper's product roadmap?
3. Are there any attribution requirements?
4. Any recommendations for safer alternatives?

**Deadline:** Before feature merge (target: EOD tomorrow)
**Contact:** [Your name]
```
