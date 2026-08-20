/**
 * OMP backend driver.
 *
 * OMP runs as a plain CLI subprocess (`omp --mode rpc`) and manages its own
 * auth + model config (~/.omp/agent), so there is nothing to prepare or
 * inject: no interceptor bundle, no credential cache, no model fetcher.
 */

import type {
  DriverBuildArgs,
  BackendRuntimePayload,
  ProviderDriver,
} from '../driver-types.ts';

export const ompDriver: ProviderDriver = {
  provider: 'omp',
  buildRuntime(_args: DriverBuildArgs): BackendRuntimePayload {
    // OMP binary is resolved by OmpAgent from OMP_CLI_PATH env or PATH.
    return {};
  },
};
