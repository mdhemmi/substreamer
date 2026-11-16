jest.mock('../../store/persistence/kvStorage', () =>
  require('../../store/persistence/__mocks__/kvStorage'),
);

import { authStore } from '../../store/authStore';
import {
  applyPangolinHeaders,
  isPangolinGateResponse,
  notePangolinGateResponse,
  pangolinProxyPlan,
  pangolinRequestHeaders,
  requestHostname,
  responseIsPangolinGate,
  ssoNeedsReauth,
  type PangolinCredential,
} from '../pangolinAuth';

const TOKEN: PangolinCredential = { kind: 'token', tokenId: 'tid', token: 'secret' };
const SSO: PangolinCredential = {
  kind: 'sso',
  host: 'music.example.com',
  cookies: [
    { name: 'p_session_token_s.1', value: 'abc', expiresAt: null },
    { name: 'other', value: 'zzz', expiresAt: 5_000 },
  ],
};

beforeEach(() => {
  authStore.setState({
    isLoggedIn: false,
    pangolin: null,
    pangolinReauthRequired: false,
    serverUrl: null,
    username: null,
    password: null,
  });
});

describe('pangolinRequestHeaders', () => {
  it('returns nothing without a credential', () => {
    expect(pangolinRequestHeaders('https://music.example.com/rest/ping.view', null)).toEqual({});
  });

  it('sends the access-token headers and never the secret in a query', () => {
    const headers = pangolinRequestHeaders('https://music.example.com/rest/ping.view', TOKEN);
    expect(headers).toEqual({
      'P-Access-Token-Id': 'tid',
      'P-Access-Token': 'secret',
    });
    expect(JSON.stringify(headers)).not.toContain('?');
  });

  it('omits a blank access token', () => {
    expect(pangolinRequestHeaders('https://music.example.com', {
      kind: 'token', tokenId: 'tid', token: '  ',
    })).toEqual({});
  });

  it('sends live SSO cookies only to the host they were captured for', () => {
    const headers = pangolinRequestHeaders('https://music.example.com/rest/ping.view', SSO, 1_000);
    expect(headers).toEqual({ Cookie: 'p_session_token_s.1=abc; other=zzz' });
    expect(pangolinRequestHeaders('https://other.example.com/rest/ping.view', SSO, 1_000)).toEqual({});
  });

  it('drops an expired cookie and skips the host when none remain', () => {
    const headers = pangolinRequestHeaders('https://Music.Example.com/x', SSO, 9_000);
    expect(headers).toEqual({ Cookie: 'p_session_token_s.1=abc' });
    expect(ssoNeedsReauth({
      kind: 'sso',
      host: 'music.example.com',
      cookies: [{ name: 'a', value: 'b', expiresAt: 10 }],
    }, 11)).toBe(true);
    expect(ssoNeedsReauth(TOKEN)).toBe(false);
  });
});

describe('requestHostname', () => {
  it('reads a bare host and a URL', () => {
    expect(requestHostname('Music.Example.com')).toBe('music.example.com');
    expect(requestHostname('https://music.example.com:4533/rest')).toBe('music.example.com');
    expect(requestHostname('')).toBeNull();
    expect(requestHostname('http://')).toBeNull();
  });
});

describe('isPangolinGateResponse', () => {
  it('matches Pangolin 401s and ignores a Subsonic failure', () => {
    expect(isPangolinGateResponse(401, 'Basic realm="pangolin"', null)).toBe(true);
    expect(isPangolinGateResponse(401, null, 'text/html; charset=utf-8')).toBe(true);
    expect(isPangolinGateResponse(401, null, 'application/json')).toBe(false);
    expect(isPangolinGateResponse(200, 'Basic realm="pangolin"', 'text/html')).toBe(false);
  });

  it('reads an HTML body when the 401 has no type', async () => {
    const html = new Response('<html><body>pangolin</body></html>', { status: 401 });
    const json = new Response('{"subsonic-response":{"status":"failed"}}', {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
    const subsonicBody = new Response('{"subsonic-response":{"status":"failed"}}', { status: 401 });
    expect(await responseIsPangolinGate(html)).toBe(true);
    expect(await responseIsPangolinGate(json)).toBe(false);
    expect(await responseIsPangolinGate(subsonicBody)).toBe(false);
  });

  it('does not flag re-auth for a Subsonic failure or a logged-out session', async () => {
    await notePangolinGateResponse(new Response('nope', { status: 200 }));
    expect(authStore.getState().pangolinReauthRequired).toBe(false);

    authStore.setState({
      isLoggedIn: true,
      pangolin: TOKEN,
      serverUrl: 'https://music.example.com',
      username: 'user',
      password: 'pass',
    });
    await notePangolinGateResponse(new Response('{}', {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }));
    expect(authStore.getState().pangolinReauthRequired).toBe(false);

    await notePangolinGateResponse(new Response('<html>pangolin</html>', { status: 401 }));
    expect(authStore.getState().pangolinReauthRequired).toBe(true);
  });
});

describe('applyPangolinHeaders', () => {
  it('leaves the request alone when there is nothing to add', () => {
    const init = { method: 'GET' };
    expect(applyPangolinHeaders(init, {})).toBe(init);
  });

  it('merges onto headers the caller already set', () => {
    const next = applyPangolinHeaders(
      { headers: { 'Content-Type': 'application/json' } },
      { Cookie: 'a=b' },
    );
    const headers = new Headers(next?.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('Cookie')).toBe('a=b');
  });
});

describe('pangolinProxyPlan', () => {
  const base = {
    serverUrl: 'https://music.example.com',
    primaryServerUrl: 'https://music.example.com',
    secondaryServerUrl: 'https://lan.example.com',
  };

  it('is empty without a credential', () => {
    expect(pangolinProxyPlan({ ...base, pangolin: null })).toEqual({
      urls: [], headers: {}, hosts: [], reauth: false,
    });
  });

  it('registers every slot for an access token', () => {
    const plan = pangolinProxyPlan({ ...base, pangolin: TOKEN });
    expect(plan.urls).toEqual(['https://music.example.com', 'https://lan.example.com']);
    expect(plan.hosts).toEqual(['music.example.com', 'lan.example.com']);
    expect(plan.headers['P-Access-Token']).toBe('secret');
    expect(plan.reauth).toBe(false);
  });

  it('registers only the SSO host, and asks for a new sign-in when the cookies are dead', () => {
    const plan = pangolinProxyPlan({ ...base, pangolin: SSO }, 1_000);
    expect(plan.urls).toEqual(['https://music.example.com']);
    expect(plan.hosts).toEqual(['music.example.com']);
    expect(plan.headers.Cookie).toContain('p_session_token_s.1=abc');

    const dead = pangolinProxyPlan({
      ...base,
      pangolin: {
        kind: 'sso',
        host: 'music.example.com',
        cookies: [{ name: 'a', value: 'b', expiresAt: 10 }],
      },
    }, 20);
    expect(dead).toEqual({ urls: [], headers: {}, hosts: [], reauth: true });
  });
});
