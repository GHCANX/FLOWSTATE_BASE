import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  SlippiAuthClient,
  getSlippiAuth,
  resetSlippiAuth,
  FIREBASE_SIGNIN_URL,
  SLIPPI_GRAPHQL_URL,
} from '../../src/broadcast/slippiAuth.js';

describe('SlippiAuthClient', () => {
  let tmpDir;
  let credentialsPath;
  let originalFetch;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slippi-auth-test-'));
    credentialsPath = path.join(tmpDir, 'credentials.json');
    originalFetch = global.fetch;
    resetSlippiAuth();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (fs.existsSync(credentialsPath)) {
      fs.unlinkSync(credentialsPath);
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    resetSlippiAuth();
  });

  it('instantiates with default options', () => {
    const client = new SlippiAuthClient();
    assert.ok(client.credentialsPath.endsWith('data/slippi_credentials.json'));
    assert.ok(client.firebaseSignInUrl.includes('identitytoolkit.googleapis.com'));
  });

  it('instantiates with custom options', () => {
    const client = new SlippiAuthClient({
      credentialsPath,
      firebaseSignInUrl: 'http://test.com/signin',
      firebaseRefreshUrl: 'http://test.com/refresh',
      slippiGraphqlUrl: 'http://test.com/graphql',
    });
    assert.strictEqual(client.credentialsPath, credentialsPath);
    assert.strictEqual(client.firebaseSignInUrl, 'http://test.com/signin');
    assert.strictEqual(client.firebaseRefreshUrl, 'http://test.com/refresh');
    assert.strictEqual(client.slippiGraphqlUrl, 'http://test.com/graphql');
  });

  it('login throws if email or password is missing', async () => {
    const client = new SlippiAuthClient({ credentialsPath });
    await assert.rejects(client.login('', 'pass'), /Email and password are required/);
    await assert.rejects(client.login('email', ''), /Email and password are required/);
  });

  it('login successful and fetches user profile', async () => {
    let fetchCallCount = 0;
    global.fetch = async (url) => {
      fetchCallCount++;
      if (url.includes('identitytoolkit')) {
        return {
          ok: true,
          json: async () => ({
            localId: 'testUid',
            idToken: 'testIdToken',
            refreshToken: 'testRefreshToken',
            email: 'test@example.com',
            expiresIn: '3600',
          }),
        };
      }
      if (url.includes('graphql')) {
        return {
          ok: true,
          json: async () => ({
            data: {
              getUser: {
                displayName: 'TestUser',
                connectCode: { code: 'TEST#123' },
              },
            },
          }),
        };
      }
      return { ok: false, status: 500 };
    };

    const client = new SlippiAuthClient({ credentialsPath });
    const summary = await client.login('test@example.com', 'password123');

    assert.strictEqual(fetchCallCount, 2);
    assert.strictEqual(client.fbUid, 'testUid');
    assert.strictEqual(client.idToken, 'testIdToken');
    assert.strictEqual(client.refreshToken, 'testRefreshToken');
    assert.strictEqual(client.displayName, 'TestUser');
    assert.strictEqual(client.connectCode, 'TEST#123');

    assert.strictEqual(summary.authenticated, true);
    assert.strictEqual(summary.uid, 'testUid');

    assert.ok(fs.existsSync(credentialsPath));
    const saved = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    assert.strictEqual(saved.fbUid, 'testUid');
  });

  it('uses the internal Slippi GraphQL gateway and current user query shape', async () => {
    assert.equal(SLIPPI_GRAPHQL_URL, 'https://internal.slippi.gg');

    const requests = [];
    global.fetch = async (url, options) => {
      requests.push({ url, options });
      if (url === FIREBASE_SIGNIN_URL) {
        return {
          ok: true,
          json: async () => ({
            localId: 'firebase-user-123',
            email: 'player@example.com',
            idToken: 'id-token',
            refreshToken: 'refresh-token',
            expiresIn: '3600',
          }),
        };
      }

      assert.equal(url, SLIPPI_GRAPHQL_URL);
      return {
        ok: true,
        json: async () => ({
          data: {
            getUser: {
              displayName: 'Player',
              connectCode: { code: 'PLAY#001' },
            },
          },
        }),
      };
    };

    const client = new SlippiAuthClient({ credentialsPath });
    const account = await client.login('player@example.com', 'password');
    const graphqlRequest = requests[1];
    const payload = JSON.parse(graphqlRequest.options.body);

    assert.equal(account.displayName, 'Player');
    assert.equal(account.connectCode, 'PLAY#001');
    assert.equal(payload.operationName, 'UserProfilePageQuery');
    assert.deepEqual(payload.variables, { cc: null, uid: 'firebase-user-123' });
    assert.match(payload.query, /getUser\(connectCode: \$cc, fbUid: \$uid\)/);
  });

  it('login handles firebase auth failure', async () => {
    global.fetch = async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        error: { message: 'INVALID_PASSWORD' },
      }),
    });

    const client = new SlippiAuthClient({ credentialsPath });
    await assert.rejects(client.login('test@example.com', 'wrongpass'), /INVALID_PASSWORD/);
  });

  it('refresh fetches new tokens', async () => {
    const client = new SlippiAuthClient({ credentialsPath });
    client.refreshToken = 'oldRefreshToken';
    client.fbUid = 'testUid';

    global.fetch = async (url) => {
      if (url.includes('securetoken')) {
        return {
          ok: true,
          json: async () => ({
            id_token: 'newIdToken',
            refresh_token: 'newRefreshToken',
            user_id: 'testUid',
            expires_in: '3600',
          }),
        };
      }
      return { ok: false, status: 500 };
    };

    const newToken = await client.refresh();
    assert.strictEqual(newToken, 'newIdToken');
    assert.strictEqual(client.idToken, 'newIdToken');
    assert.strictEqual(client.refreshToken, 'newRefreshToken');

    assert.ok(fs.existsSync(credentialsPath));
    const saved = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    assert.strictEqual(saved.idToken, 'newIdToken');
  });

  it('refresh throws if no refresh token', async () => {
    const client = new SlippiAuthClient({ credentialsPath });
    await assert.rejects(client.refresh(), /No refresh token available/);
  });

  it('getValidIdToken returns existing token if valid', async () => {
    const client = new SlippiAuthClient({ credentialsPath });
    client.fbUid = 'uid';
    client.idToken = 'validToken';
    client.refreshToken = 'refToken';
    client.expiresAt = Date.now() + 10 * 60 * 1000;

    const token = await client.getValidIdToken();
    assert.strictEqual(token, 'validToken');
  });

  it('getValidIdToken calls refresh if token expiring soon', async () => {
    const client = new SlippiAuthClient({ credentialsPath });
    client.fbUid = 'uid';
    client.idToken = 'oldToken';
    client.refreshToken = 'refToken';
    client.expiresAt = Date.now() + 4 * 60 * 1000;

    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        id_token: 'refreshedToken',
        expires_in: '3600',
      }),
    });

    const token = await client.getValidIdToken();
    assert.strictEqual(token, 'refreshedToken');
  });

  it('getValidIdToken throws if not authenticated', async () => {
    const client = new SlippiAuthClient({ credentialsPath });
    await assert.rejects(client.getValidIdToken(), /Not authenticated/);
  });

  it('logout clears state and deletes credentials file', () => {
    fs.writeFileSync(credentialsPath, JSON.stringify({ fbUid: 'uid' }));

    const client = new SlippiAuthClient({ credentialsPath });
    client.fbUid = 'uid';
    client.idToken = 'token';

    const res = client.logout();

    assert.strictEqual(res.success, true);
    assert.strictEqual(client.fbUid, null);
    assert.strictEqual(client.idToken, null);
    assert.ok(!fs.existsSync(credentialsPath));
  });

  it('loadFromDisk recovers state', () => {
    const data = {
      fbUid: 'savedUid',
      idToken: 'savedToken',
      refreshToken: 'savedRefToken',
      expiresAt: 123456789,
      email: 'saved@example.com',
      displayName: 'SavedUser',
      connectCode: 'SAV#123',
    };
    fs.writeFileSync(credentialsPath, JSON.stringify(data));

    const client = new SlippiAuthClient({ credentialsPath });
    assert.strictEqual(client.fbUid, 'savedUid');
    assert.strictEqual(client.idToken, 'savedToken');
    assert.strictEqual(client.displayName, 'SavedUser');
    assert.strictEqual(client.isAuthenticated(), true);
  });

  it('global getSlippiAuth returns singleton', () => {
    const inst1 = getSlippiAuth({ credentialsPath });
    const inst2 = getSlippiAuth({ credentialsPath });
    assert.strictEqual(inst1, inst2);
  });
});
