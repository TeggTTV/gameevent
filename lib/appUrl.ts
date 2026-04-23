const DEFAULT_DEV_APP_URL = 'http://localhost:30000';
const DEFAULT_PROD_APP_URL = 'https://aixbusinessevent.vercel.app';

function normalizeBaseUrl(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export function getPublicAppUrl(): string {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configuredUrl) return normalizeBaseUrl(configuredUrl);

  return process.env.NODE_ENV === 'production'
    ? DEFAULT_PROD_APP_URL
    : DEFAULT_DEV_APP_URL;
}
