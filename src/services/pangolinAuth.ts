/**
 * Pangolin sits in front of the music server. A credential is either the
 * resource-host cookies from a browser sign-in, or a shareable-link access
 * token. Subsonic username and password stay on the request as well.
 */

import { authStore } from '../store/authStore';

export interface PangolinCookie {
  name: string;
  value: string;
  /** Epoch milliseconds. Null is a session cookie. */
  expiresAt: number | null;
}

export type PangolinCredential =
  | { kind: 'sso'; host: string; cookies: PangolinCookie[] }
  | { kind: 'token'; tokenId: string; token: string };

export const PANGOLIN_TOKEN_ID_HEADER = 'P-Access-Token-Id';
export const PANGOLIN_TOKEN_HEADER = 'P-Access-Token';

export interface PangolinProxyPlan {
  /** Server URLs to register on the iOS loopback proxy without a pinned cert. */
  urls: string[];
  headers: Record<string, string>;
  /** Hostnames that receive `headers` on the proxied upstream request. */
  hosts: string[];
  /** Every SSO cookie is already expired, so the user has to sign in again. */
  reauth: boolean;
}

export function requestHostname(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function liveCookies(cookies: PangolinCookie[], now: number): PangolinCookie[] {
  return cookies.filter(
    (cookie) =>
      cookie.name.length > 0 &&
      (cookie.expiresAt == null || cookie.expiresAt > now),
  );
}

/** True when an SSO credential has no cookie that can still be sent. */
export function ssoNeedsReauth(credential: PangolinCredential | null, now = Date.now()): boolean {
  if (!credential || credential.kind !== 'sso') return false;
  return liveCookies(credential.cookies, now).length === 0;
}

/**
 * Headers for one request. SSO cookies are sent only when `requestUrl`'s host
 * is the host they were captured for. An access token is sent to any host.
 * Returns an empty object when there is nothing to send.
 */
export function pangolinRequestHeaders(
  requestUrl: string,
  credential: PangolinCredential | null,
  now = Date.now(),
): Record<string, string> {
  if (!credential) return {};
  if (credential.kind === 'token') {
    const tokenId = credential.tokenId.trim();
    const token = credential.token.trim();
    if (!tokenId || !token) return {};
    return {
      [PANGOLIN_TOKEN_ID_HEADER]: tokenId,
      [PANGOLIN_TOKEN_HEADER]: token,
    };
  }
  const host = requestHostname(requestUrl);
  if (!host || host !== credential.host.toLowerCase()) return {};
  const cookies = liveCookies(credential.cookies, now);
  if (cookies.length === 0) return {};
  return { Cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ') };
}

/**
 * A Pangolin wall is HTTP 401 with Pangolin's basic-auth challenge, or an HTML
 * page instead of a Subsonic envelope. A JSON 401 is not treated as the wall.
 */
export function isPangolinGateResponse(
  status: number,
  wwwAuthenticate: string | null,
  contentType: string | null,
): boolean {
  if (status !== 401) return false;
  if (wwwAuthenticate && /pangolin/i.test(wwwAuthenticate)) return true;
  if (contentType && /text\/html/i.test(contentType)) return true;
  return false;
}

/** Enough of a fetch response to classify a Pangolin wall. */
export interface GateProbeResponse {
  status: number;
  headers: { get(name: string): string | null };
  clone(): { text(): Promise<string> };
}

/** Header check, then a cloned body when the 401 did not name its type. */
export async function responseIsPangolinGate(response: GateProbeResponse): Promise<boolean> {
  const wwwAuthenticate = response.headers.get('www-authenticate');
  const contentType = response.headers.get('content-type');
  if (isPangolinGateResponse(response.status, wwwAuthenticate, contentType)) return true;
  if (response.status !== 401) return false;
  if (contentType && /json/i.test(contentType)) return false;
  try {
    const text = (await response.clone().text()).trimStart().slice(0, 400).toLowerCase();
    if (text.includes('subsonic-response')) return false;
    return text.startsWith('<!doctype html') || text.startsWith('<html') || text.includes('pangolin');
  } catch {
    return false;
  }
}

/**
 * Sets the re-auth flag once, and only for a live session that already has a gate.
 * Returns whether this response is the gate, including an HTML body with no content type.
 */
export async function notePangolinGateResponse(response: GateProbeResponse): Promise<boolean> {
  const { isLoggedIn, pangolin, pangolinReauthRequired, setPangolinReauthRequired } = authStore.getState();
  if (!isLoggedIn || !pangolin || pangolinReauthRequired) return false;
  const hit = await responseIsPangolinGate(response);
  if (hit) setPangolinReauthRequired(true);
  return hit;
}

export function applyPangolinHeaders(
  init: RequestInit | undefined,
  extra: Record<string, string>,
): RequestInit | undefined {
  if (Object.keys(extra).length === 0) return init;
  const headers = new Headers(init?.headers);
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return { ...init, headers };
}

export function requestInputUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function configuredServerUrls(state: {
  serverUrl: string | null;
  primaryServerUrl: string | null;
  secondaryServerUrl: string | null;
}): string[] {
  return [...new Set(
    [state.serverUrl, state.primaryServerUrl, state.secondaryServerUrl].filter(
      (url): url is string => !!url,
    ),
  )];
}

/** What the iOS loopback proxy should register and attach for the current session. */
export function pangolinProxyPlan(
  state: {
    pangolin?: PangolinCredential | null;
    serverUrl: string | null;
    primaryServerUrl: string | null;
    secondaryServerUrl: string | null;
  },
  now = Date.now(),
): PangolinProxyPlan {
  const empty: PangolinProxyPlan = { urls: [], headers: {}, hosts: [], reauth: false };
  const credential = state.pangolin ?? null;
  if (!credential) return empty;
  const urls = configuredServerUrls(state);
  if (credential.kind === 'token') {
    const headers = pangolinRequestHeaders(urls[0] ?? 'https://localhost', credential, now);
    const hosts = urls
      .map((url) => requestHostname(url))
      .filter((host): host is string => !!host);
    return { urls, headers, hosts, reauth: false };
  }
  if (ssoNeedsReauth(credential, now)) return { ...empty, reauth: true };
  const host = credential.host.toLowerCase();
  const matched = urls.filter((url) => requestHostname(url) === host);
  const headers = pangolinRequestHeaders(matched[0] ?? `https://${host}`, credential, now);
  return {
    urls: matched,
    headers,
    hosts: headers.Cookie ? [host] : [],
    reauth: false,
  };
}
