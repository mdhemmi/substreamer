jest.mock('../../store/persistence/kvStorage', () =>
  require('../../store/persistence/__mocks__/kvStorage'),
);

const mockLogin = jest.fn();
jest.mock('../subsonicService', () => ({
  login: (...args: unknown[]) => mockLogin(...args),
}));

const mockSync = jest.fn(() => Promise.resolve());
jest.mock('../sslTrustService', () => ({
  syncProxyUpstreams: () => mockSync(),
}));

import { authStore } from '../../store/authStore';
import { replacePangolinCredential } from '../pangolinSession';

const TOKEN = { kind: 'token' as const, tokenId: 'tid', token: 'secret' };

beforeEach(() => {
  mockLogin.mockReset();
  mockSync.mockClear();
  authStore.setState({
    serverUrl: 'https://music.example.com',
    username: 'ada',
    password: 'pass',
    legacyAuth: false,
    isLoggedIn: true,
    pangolin: null,
    pangolinReauthRequired: true,
  });
});

describe('replacePangolinCredential', () => {
  it('saves the new gate after a successful ping and refreshes the proxy', async () => {
    mockLogin.mockResolvedValue({ success: true, version: '1.16.0' });

    await expect(replacePangolinCredential(TOKEN)).resolves.toEqual({ ok: true });

    expect(mockLogin).toHaveBeenCalledWith(
      'https://music.example.com', 'ada', 'pass', false, TOKEN,
    );
    expect(authStore.getState().pangolin).toEqual(TOKEN);
    expect(authStore.getState().pangolinReauthRequired).toBe(false);
    expect(authStore.getState().serverUrl).toBe('https://music.example.com');
    expect(mockSync).toHaveBeenCalledTimes(1);
  });

  it('leaves the saved gate when the ping fails', async () => {
    const saved = { kind: 'token' as const, tokenId: 'old', token: 'old' };
    authStore.setState({ pangolin: saved });
    mockLogin.mockResolvedValue({ success: false, error: 'nope' });

    await expect(replacePangolinCredential(TOKEN)).resolves.toEqual({ ok: false, error: 'nope' });

    expect(authStore.getState().pangolin).toEqual(saved);
    expect(mockSync).not.toHaveBeenCalled();
  });

  it('does nothing when there is no session to attach the gate to', async () => {
    authStore.setState({ serverUrl: null });

    const result = await replacePangolinCredential(TOKEN);

    expect(result.ok).toBe(false);
    expect(mockLogin).not.toHaveBeenCalled();
  });
});
