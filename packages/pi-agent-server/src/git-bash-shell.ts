export const GIT_BASH_PATH_ENV_VAR = 'CLAUDE_CODE_GIT_BASH_PATH';

export function resolveConfiguredGitBashShellPath(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const value = env[GIT_BASH_PATH_ENV_VAR]?.trim();
  return value || undefined;
}
