/**
 * ESLint Rule: env-sanitizer-audit
 *
 * Flags every child-process spawn call (Bun.spawn / Bun.spawnSync and
 * node:child_process spawn / spawnSync / exec / execFile) whose `env`
 * option references `process.env` *without* being piped through
 * `sanitizeChildProcessEnv` (or another allow-listed sanitizer helper).
 *
 * Why this exists
 * ----------------
 * A subset of WSL → Windows-shell environment imports leak through
 * into `process.env` as the literal string `"undefined"` or `""`.
 * Spreading `process.env` directly into a child env/value map lets
 * those pathological entries reach the subprocess and hit
 * downstream consumers that assume a clean string.
 *
 * The accepted remediation is the central `sanitizeChildProcessEnv`
 * helper in `@archstudio/shared/utils/env` (also exported from
 * `@archstudio/shared/utils`). This rule stops a future contributor
 * from re-introducing the leak with a one-call spread; if you must
 * accept a different sanitizer naming (e.g. the automations-specific
 * `cleanEnv` wrapper), pass `allowedSanitizers` in the rule options.
 *
 * Scope (deliberately limited)
 * ---------------------------
 * - In-place options objects only. A pattern like
 *     const opts = { env: { ...process.env } }
 *     Bun.spawn(['x'], opts)
 *   is **not** detected — the project doesn't currently use that
 *   shape and adding indirection-tracking would invite false
 *   positives for named local variables.
 * - Standalone `spawn`/`spawnSync`/`exec`/`execFile` are matched by
 *   callee name only. The project standard is to import them from
 *   `node:child_process` (or `bun`), so a user-local helper named
 *   `spawn` would also trip the rule. If you genuinely need a helper
 *   with one of these names, prefix it (`spawnHelper`) or pass
 *   `additionalCallNames: []` from the rule options.
 *
 * Messages
 * --------
 * - `unsafeProcessEnvDirect`  — `env: process.env` (no wrap)
 * - `unsafeProcessEnvSpread`  — `env: { ...process.env, ... }`
 *   (the spread path that started the WSL leak chain).
 */

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid spreading or passing process.env into a child-process env without sanitizeChildProcessEnv.',
      category: 'Security',
      recommended: false,
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowedSanitizers: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
          },
          additionalCallNames: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      unsafeProcessEnvDirect:
        'Passing `env: process.env` (or a TS cast of it) into a child-process spawn leaks undefined / "undefined" / "" vars on Windows. Wrap in sanitizeChildProcessEnv() first.',
      unsafeProcessEnvSpread:
        'Spreading `process.env` into `env: { ... }` leaks undefined / "undefined" / "" vars on Windows. Wrap the spread in sanitizeChildProcessEnv() instead.',
    },
  },

  create(context) {
    const options = context.options[0] || {}
    const allowedSanitizers = new Set(
      options.allowedSanitizers && options.allowedSanitizers.length > 0
        ? options.allowedSanitizers
        : ['sanitizeChildProcessEnv'],
    )
    const additionalCallNames = new Set(options.additionalCallNames || [])

    const BUN_SPAWN_NAMES = new Set(['spawn', 'spawnSync'])
    const CHILD_PROCESS_NAMES = new Set([
      'spawn',
      'spawnSync',
      'execFile',
      'exec',
    ])
    const TRACKED_CALL_NAMES = new Set([
      ...CHILD_PROCESS_NAMES,
      ...additionalCallNames,
    ])

    /**
     * Recursively inspect a node and decide whether it carries a
     * `process.env` reference (either as a direct identifier, inside
     * a spread source, wrapped in a TS cast, etc.). Capped at depth
     * 4 — beyond that the AST has nested ternaries / IIFEs that the
     * human reviewer should look at anyway.
     */
    function hasProcessEnvReference(node, depth = 0) {
      if (!node || depth > 4) return false

      // TSAsExpression — process.env as Record<string,string> etc.
      if (node.type === 'TSAsExpression' || node.type === 'TSTypeAssertion' || node.type === 'TSNonNullExpression') {
        return hasProcessEnvReference(node.expression, depth + 1)
      }

      // Parenthesised expression — unwrap and recurse.
      if (node.type === 'ParenthesizedExpression') {
        return hasProcessEnvReference(node.expression, depth + 1)
      }

      // Identifier shape: process.env directly assigned to env.
      if (node.type === 'Identifier') {
        return node.name === 'processEnv' || node.name === 'parentEnv'
      }

      // MemberExpression shape: any member access whose root is the
      // identifier `process` and the property is `env`.
      if (node.type === 'MemberExpression') {
        const root = getRootIdentifier(node)
        if (root && root.name === 'process' && isEnvProperty(node)) {
          return true
        }
        // Don't recurse further — child-process options are not
        // MemberExpressions.
        return false
      }

      // Object literal: walk every spread and value.
      if (node.type === 'ObjectExpression') {
        for (const prop of node.properties) {
          if (prop.type === 'SpreadElement') {
            if (hasProcessEnvReference(prop.argument, depth + 1)) return true
            continue
          }
          if (prop.type === 'Property') {
            if (hasProcessEnvReference(prop.value, depth + 1)) return true
          }
        }
        return false
      }

      // Conditional / logical / chained — recurse both sides.
      if (node.type === 'ConditionalExpression') {
        return (
          hasProcessEnvReference(node.test, depth + 1) ||
          hasProcessEnvReference(node.consequent, depth + 1) ||
          hasProcessEnvReference(node.alternate, depth + 1)
        )
      }
      if (
        node.type === 'LogicalExpression' ||
        node.type === 'BinaryExpression'
      ) {
        return (
          hasProcessEnvReference(node.left, depth + 1) ||
          hasProcessEnvReference(node.right, depth + 1)
        )
      }

      // Call expression: an ALLOW-LISTED sanitizer neutralizes the
      // leak (return false). Any OTHER call is transparent — we
      // walk into its arguments because leaking process.env through
      // an unrecognized helper is exactly the bug we are guarding
      // against.
      if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
        if (isAllowedSanitizerCall(node)) return false
        return node.arguments.some((arg) =>
          hasProcessEnvReference(arg, depth + 1),
        )
      }

      return false
    }

    /**
     * Returns true when the node is a *direct* (non-spread) reference
     * to process.env — i.e. the value is `process.env` itself, with
     * optional TS cast. Spread paths emit a separate message id.
     */
    function isDirectProcessEnvAssign(node) {
      return (
        hasProcessEnvReference(node) &&
        !isInsideSpread(node)
      )
    }

    /**
     * Whether this node sits as the argument of a SpreadElement.
     * Used to pick between the two message ids.
     */
    function isInsideSpread(node) {
      // We can't reliably walk parents in ESLint visitors; instead
      // we rely on the caller to pass us a value that's already been
      // extracted and ask "is this value a SpreadElement argument?"
      return node && node.__envSanitizerInsideSpread === true
    }

    function getRootIdentifier(node) {
      let cur = node
      while (cur && cur.type === 'MemberExpression') {
        cur = cur.object
      }
      return cur && cur.type === 'Identifier' ? cur : null
    }

    function isEnvProperty(memberExpr) {
      const prop = memberExpr.property
      if (!prop || memberExpr.computed) return false
      if (prop.type !== 'Identifier' || prop.name !== 'env') return false
      // Make sure `env` is the immediate property, not a leaf of a
      // deeper path like `process.env.foo`.
      return memberExpr.object && getRootIdentifier(memberExpr).name === 'process'
    }

    function isAllowedSanitizerCall(node) {
      if (!node || node.type !== 'CallExpression') return false
      const callee = node.callee
      if (!callee) return false
      // Bare identifier call: sanitizeChildProcessEnv(...)
      if (callee.type === 'Identifier' && allowedSanitizers.has(callee.name)) {
        return true
      }
      // Namespace member call — not used by the current project, but
      // permissive in case a wrapping helper ever lands.
      if (
        callee.type === 'MemberExpression' &&
        !callee.computed &&
        callee.property &&
        callee.property.type === 'Identifier' &&
        allowedSanitizers.has(callee.property.name)
      ) {
        return true
      }
      return false
    }

    function isEnvPropertyKey(node) {
      if (!node) return false
      if (node.type === 'Identifier') return node.name === 'env'
      if (node.type === 'Literal') return node.value === 'env'
      return false
    }

    /**
     * Walk the options argument and emit a report for every
     * process.env leak we can statically identify.  Returns the
     * number of issues reported so the caller can short-circuit.
     */
    function inspectOptionsArg(optsNode, callExpressionRange) {
      if (!optsNode) return 0
      // TS casts around the whole options bag — unwrap.
      if (
        optsNode.type === 'TSAsExpression' ||
        optsNode.type === 'TSTypeAssertion'
      ) {
        return inspectOptionsArg(optsNode.expression, callExpressionRange)
      }
      if (optsNode.type !== 'ObjectExpression') {
        // Indirected options — bail; not in scope for this rule.
        return 0
      }

      let reports = 0
      for (const prop of optsNode.properties) {
        if (prop.type !== 'Property' || !isEnvPropertyKey(prop.key)) continue
        const envValue = prop.value

        // Sanitizer-wrap — clean.
        if (isAllowedSanitizerCall(envValue)) continue

        if (hasProcessEnvReference(envValue)) {
          const spread = isSpreadSource(envValue)
          context.report({
            node: prop,
            messageId: spread ? 'unsafeProcessEnvSpread' : 'unsafeProcessEnvDirect',
          })
          reports++
        }
      }
      return reports
    }

    /**
     * Decide whether the env value reaches process.env via a spread
     * (vs direct identifier assignment). We compare the rule's
     * recursive descent: did we encounter a SpreadElement whose
     * argument holds the leak?
     */
    function isSpreadSource(valueNode) {
      return walk(valueNode)
      function walk(node, depth = 0) {
        if (!node || depth > 4) return false
        if (node.type === 'TSAsExpression' || node.type === 'TSTypeAssertion' || node.type === 'TSNonNullExpression') {
          return walk(node.expression, depth + 1)
        }
        if (node.type === 'ParenthesizedExpression') return walk(node.expression, depth + 1)
        if (node.type === 'ObjectExpression') {
          for (const prop of node.properties) {
            if (prop.type === 'SpreadElement') {
              if (containsProcessEnv(prop.argument, depth + 1)) return true
              if (walk(prop.argument, depth + 1)) return true
            } else if (prop.type === 'Property') {
              if (walk(prop.value, depth + 1)) return true
            }
          }
          return false
        }
        if (node.type === 'ConditionalExpression') {
          return walk(node.test, depth + 1) || walk(node.consequent, depth + 1) || walk(node.alternate, depth + 1)
        }
        if (node.type === 'LogicalExpression' || node.type === 'BinaryExpression') {
          return walk(node.left, depth + 1) || walk(node.right, depth + 1)
        }
        return false
      }
      function containsProcessEnv(node, depth) {
        if (!node || depth > 4) return false
        if (
          node.type === 'TSAsExpression' ||
          node.type === 'TSTypeAssertion' ||
          node.type === 'TSNonNullExpression'
        ) return containsProcessEnv(node.expression, depth + 1)
        if (node.type === 'ParenthesizedExpression') return containsProcessEnv(node.expression, depth + 1)
        if (node.type === 'Identifier') {
          return node.name === 'processEnv' || node.name === 'parentEnv'
        }
        if (node.type === 'MemberExpression') {
          const root = getRootIdentifier(node)
          return Boolean(root && root.name === 'process' && isEnvProperty(node))
        }
        if (node.type === 'ObjectExpression') {
          return node.properties.some(
            (p) =>
              (p.type === 'SpreadElement' && containsProcessEnv(p.argument, depth + 1)) ||
              (p.type === 'Property' && containsProcessEnv(p.value, depth + 1)),
          )
        }
        return false
      }
    }

    /**
     * Match the call's callee against our tracked set. Distinguish
     * Bun.spawn / Bun.spawnSync from the bare child_process names so
     * we don't false-positive against the `Bun.version` accessor.
     *
     * `additionalCallNames` lets the project opt in to user-local
     * helpers (e.g. `CustomNamespace.spawn`) that must obey the
     * same sanitizer rules.
     */
    function isTrackedCall(calleeNode) {
      if (!calleeNode) return false
      if (calleeNode.type === 'Identifier') {
        return CHILD_PROCESS_NAMES.has(calleeNode.name) || additionalCallNames.has(calleeNode.name)
      }
      if (
        calleeNode.type === 'MemberExpression' &&
        !calleeNode.computed &&
        calleeNode.property &&
        calleeNode.property.type === 'Identifier'
      ) {
        // Bun.spawn / Bun.spawnSync: BOTH the property name and the
        // Bun-prefixed object must match.  We deliberately do NOT
        // short-circuit on name alone — that would swallow user
        // namespace helpers (e.g. `CustomNamespace.spawn`) the
        // project opts into via additionalCallNames below.
        if (
          BUN_SPAWN_NAMES.has(calleeNode.property.name) &&
          calleeNode.object &&
          calleeNode.object.type === 'Identifier' &&
          calleeNode.object.name === 'Bun'
        ) {
          return true
        }
        // Custom namespace helpers explicitly opted-in via
        // `additionalCallNames`.  Useful when the project starts
        // using a wrapper that bears the same name as a tracked
        // builtin (e.g. spawn → CustomNamespace.spawn).
        if (additionalCallNames.has(calleeNode.property.name)) {
          return true
        }
      }
      return false
    }

    /**
     * Pick the spawn-options argument from a tracked call. Layout:
     *   Bun.spawn(cmd, opts)
     *   spawn(cmd, opts)
     *   spawn(cmd, args, opts)
     *   spawnSync(cmd, opts)
     *   spawnSync(cmd, args, opts)
     *   execFile(cmd, args, opts)
     *   exec(cmd, opts)
     *   exec(cmd, opts, callback)
     * We try the LAST positional argument first (covers the
     *   (cmd, args, opts) shape because args is always a string[]);
     * fall back to the second arg if that one isn't an
     *   ObjectExpression cast.
     */
    function selectOptionsArg(args) {
      if (!args || args.length === 0) return null
      // Last arg wins for the three-arg forms.
      for (let i = args.length - 1; i >= 0; i--) {
        const a = args[i]
        if (!a) continue
        const unwrapped =
          a.type === 'TSAsExpression' || a.type === 'TSTypeAssertion' ? a.expression : a
        if (unwrapped && unwrapped.type === 'ObjectExpression') return a
      }
      return null
    }

    return {
      CallExpression(node) {
        if (!isTrackedCall(node.callee)) return
        const optsNode = selectOptionsArg(node.arguments)
        inspectOptionsArg(optsNode, node.range)
      },
    }
  },
}
