/**
 * Constants shared between the Bun-only data store (data-store.ts) and the
 * Node-safe patch writer (data-write.ts). Kept in a dedicated runtime-neutral
 * module so data-write never has to import `bun:sqlite` transitively.
 */

/** Default cap of exported points per series (newest kept, ascending order) */
export const DEFAULT_SNAPSHOT_MAX_POINTS_PER_SERIES = 1000;

/**
 * Growth bounds on the per-page store. Points per series were always pruned
 * at export, but kv-key and distinct-series counts used to be uncapped —
 * repeated writes could grow store.sqlite (and the snapshot) without limit.
 * BOTH write engines enforce these post-write inside the write transaction
 * (rollback on violation): PageDataStore for refresh scripts, and the
 * data-write one-shot for host/tool patches.
 */
export const PAGE_DATA_MAX_KV_KEYS = 1000;
export const PAGE_DATA_MAX_SERIES = 100;
