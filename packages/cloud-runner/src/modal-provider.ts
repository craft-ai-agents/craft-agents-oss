/**
 * ModalProvider — Cloud Runs fallback via apps/modal-gateway.
 *
 * The Modal gateway mirrors the Cloudflare gateway's HTTP contract
 * verbatim (PRD §G4.1), so the provider reuses the Cloudflare client
 * and differs only in identity. subscribeEvents polling is inherited.
 */
import { CloudflareComputerProvider } from './cloudflare-provider.ts';

export class ModalProvider extends CloudflareComputerProvider {
  override readonly providerId = 'modal';
}
