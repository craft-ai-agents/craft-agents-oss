/**
 * Shared platform primitives (S-02 §3.3, S-03 §3.5).
 *
 * Pure TS: no react / electron / shared / server-core imports anywhere
 * under platform/. Renderer hosts adapt these contracts to components.
 */

/** Handle returned by registrations/subscriptions; dispose() undoes them. */
export interface Disposable {
  dispose(): void;
}
