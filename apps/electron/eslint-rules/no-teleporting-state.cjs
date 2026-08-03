/**
 * ESLint Rule: no-teleporting-state
 *
 * Flags raw `{isOpen && <JSX>}` / `{expanded && <JSX>}` conditional renders
 * that appear and disappear with zero transition — the "teleporting state"
 * class of motion bugs.
 *
 * Why this exists
 * ----------------
 * Content that mounts/unmounts on a boolean toggle with no bridge reads as
 * a hard cut: the eye loses the element between frames and the interface
 * feels jumpy. The accepted remediations are (pick one):
 *
 *   1. Wrap in <AnimatePresence> + <motion.div> (Framer Motion) for a real
 *      exit animation, or
 *   2. Add Tailwind's mount-animation utilities to the rendered element —
 *      `animate-in fade-in-0 zoom-in-95 duration-100` — which fire on
 *      mount via the tailwindcss-animate plugin.
 *
 * The rule does NOT demand an exit animation for the "tens/day" frequency
 * tier — it only demands that the mount is not a teleport.
 *
 * What is a "toggle"?
 * -------------------
 * Only genuine interactive/derived state booleans are tracked, by exact
 * name match (identifier, or non-computed member property):
 *
 *     isOpen, open, expanded, collapsed, isExpanded, isCollapsed
 *
 * A leading `!` (e.g. `!isCollapsed`) is treated as the same toggle.
 *
 * Deliberately NOT in the default set (opt in via `additionalToggleNames`):
 * `active` / `isActive`, `visible` / `isVisible`, `shown` / `isShown`.
 * Those names overwhelmingly gate micro-indicators — a 4px check icon on
 * the selected row, a trash affordance, an active-state dot — which the
 * animation philosophy rejects animating (tens/day, data-derived, too
 * small to matter). The default set is the interactive expansion/open
 * vocabulary the bug class is actually named for; extend it only if your
 * project treats those names as real toggles.
 *
 * Data gates are also NOT flagged — `showTransportConnectionBanner`,
 * `openCountCapped`, `activeSessionId`, `elapsed >= 1000` etc. render
 * decorative chips, badges and status text whose appearance is not a
 * state toggle, and animating every one of those would be noise. If your
 * project has its own toggle vocabulary, extend it via `additionalToggleNames`
 * (or narrow it with `ignoreToggleNames`). Computed members
 * (`state['isOpen']`) are likewise out of scope: the `!computed` guard
 * keeps the rule to the idiomatic dotted form.
 *
 * Exemptions
 * ----------
 * A flagged-shaped render is allowed when ANY of these hold:
 *   - an <AnimatePresence> ancestor (exit-capable, Framer Motion owns it)
 *   - the rendered element carries an `animate-in` class — string literal,
 *     cn(...) call, or template literal
 *   - the rendered element is a `motion.*` component
 *   - the rendered element name is in `allowedComponents`
 *     (default: AnimatedCollapsibleContent)
 *   - the render is a ReactDOM.createPortal(...) whose JSX argument is
 *     itself an animated element (the animate-in lives on the portalled
 *     node, which is what the user sees mount)
 *
 * Scope (deliberately limited)
 * ----------------------------
 * - `&&` chains only. `{cond ? <A> : <B>}` ternary view-swaps are a
 *   different pattern (shared-element concerns) and out of scope.
 * - A bare truthiness gate like `{someObject && <JSX>}` is only flagged
 *   when the identifier itself matches a toggle name. Comparison gates
 *   (`openSlug === slug && ...`) are data, not toggles.
 *
 * Message
 * -------
 * - `teleportingState` — the render toggles in/out with no transition.
 */

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require conditional renders gated on state toggles (isOpen / expanded / ...) to animate their mount (AnimatePresence or animate-in classes) instead of teleporting.',
      category: 'Best Practices',
      recommended: false,
    },
    schema: [
      {
        type: 'object',
        properties: {
          additionalToggleNames: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
          },
          ignoreToggleNames: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
          },
          allowedComponents: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      teleportingState:
        '`{{name}} && <JSX>` mounts with no transition — it teleports in/out. Wrap in <AnimatePresence> + <motion.div>, or add Tailwind mount-animation classes (`animate-in fade-in-0 zoom-in-95 duration-100`) to the rendered element.',
    },
  },

  create(context) {
    const options = context.options[0] || {}
    const DEFAULT_TOGGLE_NAMES = new Set([
      'isOpen',
      'open',
      'expanded',
      'collapsed',
      'isExpanded',
      'isCollapsed',
    ])
    const toggleNames = new Set([
      ...DEFAULT_TOGGLE_NAMES,
      ...(options.additionalToggleNames || []),
    ])
    for (const name of options.ignoreToggleNames || []) {
      toggleNames.delete(name)
    }
    const allowedComponents = new Set([
      'AnimatedCollapsibleContent',
      ...(options.allowedComponents || []),
    ])

    // ------------------------------------------------------------------
    // AST helpers
    // ------------------------------------------------------------------

    /** Unwrap TS casts / parens / non-null around an expression node. */
    function unwrap(node) {
      let cur = node
      while (
        cur &&
        (cur.type === 'TSAsExpression' ||
          cur.type === 'TSTypeAssertion' ||
          cur.type === 'TSNonNullExpression' ||
          cur.type === 'ParenthesizedExpression')
      ) {
        cur = cur.expression
      }
      return cur
    }

    /**
     * The display name of a toggle condition for the report message.
     * Identifier → its name; member → object.property; negation → !name.
     */
    function conditionName(node, depth = 0) {
      const n = unwrap(node)
      if (!n || depth > 4) return 'toggle'
      if (n.type === 'Identifier') return n.name
      if (n.type === 'MemberExpression' && !n.computed && n.property) {
        const obj = unwrap(n.object)
        const objName = obj && obj.type === 'Identifier' ? `${obj.name}.` : ''
        return `${objName}${n.property.name || 'property'}`
      }
      if (n.type === 'UnaryExpression' && n.operator === '!') {
        return `!${conditionName(n.argument, depth + 1)}`
      }
      // Nested && on the left of a chain (e.g. `isOpen && count > 3 && ...`).
      // Prefer the left side when it is itself a toggle, else fall back to
      // the right side before degrading to the generic placeholder.
      if (n.type === 'LogicalExpression' && n.operator === '&&') {
        if (isToggleReference(n.left, depth + 1)) {
          return conditionName(n.left, depth + 1)
        }
        if (isToggleReference(n.right, depth + 1)) {
          return conditionName(n.right, depth + 1)
        }
        return 'toggle'
      }
      return 'toggle'
    }

    /** True when the node is a tracked toggle reference (or !toggle). */
    function isToggleReference(node, depth = 0) {
      const n = unwrap(node)
      if (!n || depth > 4) return false
      if (n.type === 'Identifier') return toggleNames.has(n.name)
      if (n.type === 'UnaryExpression' && n.operator === '!') {
        return isToggleReference(n.argument, depth + 1)
      }
      if (n.type === 'MemberExpression' && !n.computed && n.property) {
        return toggleNames.has(n.property.name)
      }
      // Left side of the chain can itself be a nested &&
      // (e.g. `isOpen && result.matches.length > 3 && <button>...`).
      if (n.type === 'LogicalExpression' && n.operator === '&&') {
        return (
          isToggleReference(n.left, depth + 1) ||
          isToggleReference(n.right, depth + 1)
        )
      }
      return false
    }

    /** Collect all operands of a flattened `a && b && c` chain. */
    function flattenAndChain(node) {
      const operands = []
      let cur = node
      while (cur && cur.type === 'LogicalExpression' && cur.operator === '&&') {
        operands.push(cur.left)
        cur = cur.right
      }
      if (cur) operands.push(cur)
      return operands
    }

    /** True when an element name is `motion.xxx` (JSXMemberExpression). */
    function isMotionElement(openingElement) {
      const name = openingElement && openingElement.name
      return Boolean(
        name &&
          name.type === 'JSXMemberExpression' &&
          name.object &&
          name.object.type === 'JSXIdentifier' &&
          name.object.name === 'motion',
      )
    }

    /** True when a className attribute value mentions animate-in. */
    function classNameHasAnimateIn(valueNode, depth = 0) {
      if (!valueNode || depth > 3) return false

      // className="literal" or className={ts cast}
      const v = unwrap(valueNode)
      if (!v) return false

      // String literal.
      if (v.type === 'Literal' && typeof v.value === 'string') {
        return v.value.includes('animate-in')
      }
      // Template literal with a static quasi.
      if (v.type === 'TemplateLiteral') {
        return v.quasis.some((q) => q.value && q.value.cooked && q.value.cooked.includes('animate-in'))
      }
      // cn('animate-in ...', cond && 'animate-in', ...) — inspect every arg.
      if (v.type === 'CallExpression') {
        return v.arguments.some((arg) => classNameHasAnimateIn(arg, depth + 1))
      }
      // cn(base, isOpen && 'animate-in') — logical/concat branches.
      if (v.type === 'LogicalExpression' || v.type === 'ConditionalExpression' || v.type === 'BinaryExpression') {
        return (
          classNameHasAnimateIn(v.left, depth + 1) ||
          classNameHasAnimateIn(v.right, depth + 1)
        )
      }
      return false
    }

    /**
     * True when a rendered RHS is animated:
     *   - a JSXElement with an animate-in className, motion.* name, or
     *     an allowed component name
     *   - a createPortal(...) whose JSX argument is an animated element
     *   - a JSXFragment (children carry their own classes — recurse)
     */
    function isAnimatedRender(node, depth = 0) {
      if (!node || depth > 3) return false
      const n = unwrap(node)

      if (n.type === 'JSXElement') {
        const opening = n.openingElement
        if (isMotionElement(opening)) return true
        const name = opening && opening.name
        if (
          name &&
          name.type === 'JSXIdentifier' &&
          allowedComponents.has(name.name)
        ) {
          return true
        }
        let hasClassName = false
        // className on the element itself.
        for (const attr of opening.attributes || []) {
          if (
            attr.type === 'JSXAttribute' &&
            attr.name &&
            attr.name.type === 'JSXIdentifier' &&
            attr.name.name === 'className' &&
            attr.value
          ) {
            hasClassName = true
            const value =
              attr.value.type === 'JSXExpressionContainer' ? attr.value.expression : attr.value
            if (classNameHasAnimateIn(value)) return true
          }
        }
        // Transparent wrapper (context Provider, Suspense, etc.) with no
        // className of its own — recurse into children so the animated
        // node a portal actually renders is credited.
        if (!hasClassName) {
          return n.children.some((child) => isAnimatedRender(child, depth + 1))
        }
        // Styled surface without animate-in — a teleport.
        return false
      }

      if (n.type === 'JSXFragment') {
        return n.children.some((child) => isAnimatedRender(child, depth + 1))
      }

      // ReactDOM.createPortal(<animated>, document.body)
      if (n.type === 'CallExpression') {
        return n.arguments.some((arg) => isAnimatedRender(arg, depth + 1))
      }

      return false
    }

    /** True when any ancestor JSXElement is <AnimatePresence>. */
    function hasAnimatePresenceAncestor(node) {
      return context
        .sourceCode
        .getAncestors(node)
        .some(
          (a) =>
            a.type === 'JSXElement' &&
            a.openingElement &&
            a.openingElement.name &&
            a.openingElement.name.type === 'JSXIdentifier' &&
            a.openingElement.name.name === 'AnimatePresence',
        )
    }

    // ------------------------------------------------------------------
    // Visitor
    // ------------------------------------------------------------------

    return {
      JSXExpressionContainer(node) {
        const expr = unwrap(node.expression)
        if (!expr || expr.type !== 'LogicalExpression' || expr.operator !== '&&') {
          return
        }

        const operands = flattenAndChain(expr)
        if (operands.length < 2) return

        const renderTarget = operands[operands.length - 1]
        const conditions = operands.slice(0, -1)

        // Only fires when the render target is JSX (not a string/number/id).
        const target = unwrap(renderTarget)
        if (
          !target ||
          (target.type !== 'JSXElement' &&
            target.type !== 'JSXFragment' &&
            target.type !== 'CallExpression')
        ) {
          return
        }

        // Must be gated on a real toggle name.
        const toggle = conditions.find(isToggleReference)
        if (!toggle) return

        // Exit-capable wrapper already owns this render.
        if (hasAnimatePresenceAncestor(node)) return

        // The element itself animates on mount.
        if (isAnimatedRender(renderTarget)) return

        context.report({
          node,
          messageId: 'teleportingState',
          data: { name: conditionName(toggle) },
        })
      },
    }
  },
}
