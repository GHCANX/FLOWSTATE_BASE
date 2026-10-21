import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  FIREBASE_SIGNIN_URL,
  SLIPPI_GRAPHQL_URL,
  SlippiAuthClient,
} from '../../src/broadcast/slippiAuth.js';

const credentialsPath = path.resolve('temp_slp/slippi_auth_unit_credentials.json');

describe('SlippiAuthClient', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (fs.existsSync(credentialsPath)) fs.unlinkSync(credentialsPath);
  });

  it('uses the internal Slippi GraphQL gateway and current user query shape', async () => {
    assert.equal(SLIPPI_GRAPHQL_URL, 'https://internal.slippi.gg');

    const requests = [];
    globalThis.fetch = async (url, options) => {
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
});
