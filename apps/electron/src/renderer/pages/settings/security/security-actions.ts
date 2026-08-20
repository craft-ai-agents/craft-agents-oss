/**
 * Runs an effect only after the confirmation dialog has supplied a pending
 * action. Passing null is the cancellation path and deliberately has no effect.
 */
export async function runConfirmedSecurityAction<Action, Result>(
  pendingAction: Action | null,
  execute: (action: Action) => Promise<Result>,
): Promise<Result | undefined> {
  if (pendingAction === null) return undefined
  return execute(pendingAction)
}
