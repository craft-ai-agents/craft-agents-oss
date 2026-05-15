// Ambient module declarations for dependencies without shipped type definitions.
// Used only by the typecheck config; bun's runtime resolution handles these fine.
declare module 'turndown';
declare module 'pdfjs-dist/build/pdf.mjs';
declare module 'pdfjs-dist/build/pdf.worker.mjs';
declare module 'bash-parser';
