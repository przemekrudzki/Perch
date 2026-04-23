export const REPO_URL = 'https://github.com/KiteRunner2/Perch';

export const VERSION = __APP_VERSION__;

export function commitUrl(sha: string): string {
  return `${REPO_URL}/commit/${sha}`;
}
