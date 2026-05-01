// Happy Playwright login helper generated from CLAUDE.md.
// Requires a Playwright `page`; writes auth_credentials and MMKV server-config localStorage.
const AUTH_CREDENTIALS_JSON = '{"token":"eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJjbWk1bXY5ZWgwMHd6cGcxNHBoNzNqajNuIiwiaWF0IjoxNzczNDc4MzIwLCJuYmYiOjE3NzM0NzgzMjAsImlzcyI6ImhhbmR5IiwianRpIjoiOGE2MTRjNDAtMWVhNS00ZGRjLWFiYjgtYmI2NDdhZjNhNDVlIn0.qtK1jZFkprfJXyJ_DzuDX5yAXgUWVPzxRKLGdQSENueFC3u7xPwBT0Y9fsntDCJD5Q4eg2JZXMriqyBRx6lCBw","secret":"gWwKFlcU7I3OixXUE-aiUEEEZyzRCQSL583hd3WgALs"}';
export async function loginHappyProduction(page) {
  await page.goto('https://life-ai.app');
  await page.evaluate((authCredentialsJson) => {
    localStorage.setItem('auth_credentials', authCredentialsJson);
    localStorage.setItem('mmkv.server-config\\custom-server-url', 'https://api.life-ai.app');
  }, AUTH_CREDENTIALS_JSON);
  await page.reload();
}
