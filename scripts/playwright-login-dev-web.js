// Happy Playwright login helper generated from CLAUDE.md.
// Requires a Playwright `page`; writes auth_credentials and MMKV server-config localStorage.
const AUTH_CREDENTIALS_JSON = '{"token":"eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJjbW41dmxma3cwMDAwbGQzbHlxZGd6MWx3IiwiaWF0IjoxNzc0NDMzMDM2LCJuYmYiOjE3NzQ0MzMwMzYsImlzcyI6ImhhbmR5IiwianRpIjoiNzhmMDg0OGItNjIxMC00ZDlhLTk0YTctZjJiOTVkOTY2MzM3In0.2-X3j3nxZsXdEsD1Q-CyWTLeFwnmxBxUUWSwBLCUWW_Y710bU11CMlh0voLSH7zxc9YRUd-K6mphBqg_4DEcBw","secret":"Zd78yMPVHtUYnbR9yWWdBgzecja4UHwXaAF8Jody7Ag"}';
export async function loginHappyDevWeb(page) {
  await page.goto('https://dev.life-ai.app');
  await page.evaluate((authCredentialsJson) => {
    localStorage.setItem('auth_credentials', authCredentialsJson);
    localStorage.setItem('mmkv.server-config\\custom-server-url', 'https://api.life-ai.app');
  }, AUTH_CREDENTIALS_JSON);
  await page.reload();
}
