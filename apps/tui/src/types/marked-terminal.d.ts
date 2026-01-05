declare module 'marked-terminal' {
  import type { MarkedExtension } from 'marked';
  import type { Chalk } from 'chalk';

  interface MarkedTerminalOptions {
    // Style options (chalk functions)
    code?: Chalk;
    blockquote?: Chalk;
    html?: Chalk;
    heading?: Chalk;
    firstHeading?: Chalk;
    hr?: Chalk;
    listitem?: Chalk;
    list?: (body: string) => string;
    table?: Chalk;
    paragraph?: Chalk;
    strong?: Chalk;
    em?: Chalk;
    codespan?: Chalk;
    del?: Chalk;
    link?: Chalk;
    href?: Chalk;

    // Layout options
    showSectionPrefix?: boolean;
    unescape?: boolean;
    reflowText?: boolean;
    width?: number;

    // Tab handling
    tab?: number;

    // Emoji support
    emoji?: boolean;
  }

  export function markedTerminal(options?: MarkedTerminalOptions): MarkedExtension;
}
