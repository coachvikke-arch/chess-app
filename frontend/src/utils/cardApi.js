import axios from 'axios';

/* A bare client for the public card endpoint.
 *
 * It must NOT go through services/api.js: that instance attaches the Bearer
 * token to every request and force-logs-out on a 401, so an expired session on
 * a phone that scans a QR would bounce the visitor to the login screen instead
 * of showing the card. It still needs the SAME base URL as that client: on
 * Cloudflare Pages /api/* is caught by the SPA fallback and returns index.html,
 * which used to make every card lookup look like "Card not available". Locally
 * the Vite proxy handles same-origin /api, so keep that as the fallback. */
function apiBaseUrl(raw) {
  const base = String(raw || '').trim().replace(/\/+$/, '');
  if (!base) return '/api';
  return /\/api$/i.test(base) ? base : `${base}/api`;
}

const bare = axios.create({
  baseURL: apiBaseUrl(import.meta.env.VITE_API_URL),
  timeout: 15000,
});

export async function fetchPublicCard(token) {
  /* The endpoint is cacheable (max-age=60) for scans, but the in-app preview
     must never replay a stale copy: turning the card off and reopening the
     preview would otherwise still show the card the browser fetched a minute
     ago. The throwaway param forces a network read. */
  const res = await bare.get(`/public/card/${encodeURIComponent(String(token || ''))}`, {
    params: { v: Date.now() },
  });
  return res.data.card;
}

/** The URL a QR encodes and a share carries. */
export function cardUrl(token) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/card/${token}`;
}
