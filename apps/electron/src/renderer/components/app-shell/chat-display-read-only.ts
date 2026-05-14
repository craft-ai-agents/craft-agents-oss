export interface ChatInputVisibilityOptions {
  readOnly?: boolean
}

export function shouldRenderChatInputZone({
  readOnly = false,
}: ChatInputVisibilityOptions = {}): boolean {
  return !readOnly
}
