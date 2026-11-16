import ExpoPangolinAuthModule from '../ExpoPangolinAuthModule';
import { clearHostCookies, signIn } from '../index';

const mockModule = jest.mocked(ExpoPangolinAuthModule);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('signIn', () => {
  it('passes the server URL and cancel label to native', async () => {
    mockModule.signIn.mockResolvedValue([
      { name: 'p_session_token_s.1', value: 'abc', expiresAt: null },
    ]);
    await expect(signIn('https://music.example.com', 'Cancel')).resolves.toEqual([
      { name: 'p_session_token_s.1', value: 'abc', expiresAt: null },
    ]);
    expect(mockModule.signIn).toHaveBeenCalledWith('https://music.example.com', 'Cancel');
  });
});

describe('clearHostCookies', () => {
  it('forwards the host', async () => {
    await clearHostCookies('music.example.com');
    expect(mockModule.clearHostCookies).toHaveBeenCalledWith('music.example.com');
  });
});
