const path = require('path');

// Test the formatPathsToRelative logic
function formatPathsToRelative(text, cwd) {
  const basePath = cwd || process.cwd();
  const absolutePathRegex = /(\/(?:Users|home|var|tmp|opt|etc)[^\s\n:,\]\})"'`]*)/g;

  return text.replace(absolutePathRegex, (match) => {
    if (match.startsWith(basePath)) {
      const relativePath = path.relative(basePath, match);
      if (relativePath && !relativePath.startsWith('..') && !relativePath.startsWith('./')) {
        return './' + relativePath;
      }
      return relativePath || match;
    }
    return match;
  });
}

// Test cases
const cwd = '/Users/balintorosz/Documents/GitHub/craft-tui-agent';
const testCases = [
  '/Users/balintorosz/Documents/GitHub/craft-tui-agent/apps/electron/src/main/sessions.ts',
  'File at /Users/balintorosz/Documents/GitHub/craft-tui-agent/packages/shared/src/utils/files.ts:123',
  '/Users/other/project/file.ts',
  'Multiple: /Users/balintorosz/Documents/GitHub/craft-tui-agent/a.ts and /Users/balintorosz/Documents/GitHub/craft-tui-agent/b.ts'
];

console.log('Testing formatPathsToRelative:');
testCases.forEach(tc => {
  console.log('Input:', tc);
  console.log('Output:', formatPathsToRelative(tc, cwd));
  console.log('---');
});
