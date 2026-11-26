import axios from 'axios';

/* A bare client for the public card endpoint.
 *
 * It must NOT go through services/api.js: that instance attaches the Bearer
 * token to every request and force-logs-out on a 401, so an expired session on
 * a phone that scans a QR would bounce the visitor to the login screen instead
 * of showing the card. */
const bare = axios.create({ baseURL: '/api', timeout: 15000 });

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
