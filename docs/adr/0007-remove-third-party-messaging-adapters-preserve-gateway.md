# Remove third-party messaging adapters; preserve gateway infrastructure

The three concrete platform adapters (Telegram, WhatsApp, Lark) and the standalone `messaging-whatsapp-worker` package are removed. The `messaging-gateway` package — the `PlatformAdapter` interface, router, renderer, binding store, and config infrastructure — is kept intact as the foundation for a future custom channel.

`PlatformType` is widened from a `'telegram' | 'whatsapp' | 'lark'` literal union to `string`, and `MessagingConfig.platforms` is changed to `Record<string, { enabled: boolean }>`. These changes let any future adapter register under its own name without touching core types. The alternative was deleting the entire gateway, but the routing and rendering pipeline is non-trivial to rebuild; widening the types costs nothing and keeps the contract clean.

The `MessagingSettingsPage` is kept as a minimal placeholder so the Settings entry point survives and can be extended when the custom channel is ready.
