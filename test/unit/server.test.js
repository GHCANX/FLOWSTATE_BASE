import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { EventEmitter } from 'node:events';
import { parseJsonBody, createServer } from '../../src/server/server.js';
import { getDatabase, closeDatabase } from '../../src/database/db.js';

class MockBroadcastService extends EventEmitter {
  constructor() {
    super();
    this.auth = {
      login: async (email, password) => {
        if (email === 'fail@test.com') throw new Error('Login failed');
        return { token: 'mock-token' };
      },
      logout: () => ({ success: true }),
      getCredentialsSummary: () => ({ loggedIn: true })
    };
  }

  async startSession(body) {
    if (body.fail) throw new Error('Session start failed');
    return { sessionId: 'mock-session-id' };
  }

  getSession() {
    return { active: true };
  }

  async stopSession() {
    return { success: true };
  }
}


describe('server.js Unit Tests', () => {
  describe('parseJsonBody', () => {
    it('should parse valid JSON correctly', async () => {
      const req = new EventEmitter();
      const promise = parseJsonBody(req);

      req.emit('data', '{"test":');
      req.emit('data', ' 123}');
      req.emit('end');

      const result = await promise;
      assert.deepStrictEqual(result, { test: 123 });
    });

    it('should return empty object for empty body', async () => {
      const req = new EventEmitter();
      const promise = parseJsonBody(req);

      req.emit('end');

      const result = await promise;
      assert.deepStrictEqual(result, {});
    });

    it('should reject on invalid JSON', async () => {
      const req = new EventEmitter();
      const promise = parseJsonBody(req);

      req.emit('data', '{"test": ');
      req.emit('end');

      await assert.rejects(promise, SyntaxError);
    });

    it('should reject on stream error', async () => {
      const req = new EventEmitter();
      const promise = parseJsonBody(req);

      req.emit('error', new Error('Stream failed'));

      await assert.rejects(promise, { message: 'Stream failed' });
    });

    it('should reject and destroy stream if payload is too large', async () => {
      const req = new EventEmitter();
      let destroyed = false;
      req.destroy = () => { destroyed = true; };

      const promise = parseJsonBody(req);

      const largeChunk = 'a'.repeat(1024 * 1024 + 1);
      req.emit('data', largeChunk);

      await assert.rejects(promise, { message: 'Payload too large' });
      assert.strictEqual(destroyed, true);
    });
  });

  describe('Route Handlers', () => {

    // Global before hook handles the memory db initialization
    // before(() => getDatabase(':memory:'));

    it('should return 204 for OPTIONS requests', async () => {
      const server = createServer();
      const response = await supertest(server).options('/any-route');
      assert.strictEqual(response.status, 204);
      assert.strictEqual(response.headers['access-control-allow-origin'], '*');
      assert.strictEqual(response.headers['access-control-allow-methods'], 'GET, POST, DELETE, OPTIONS');
    });

    it('should handle /api/characters GET correctly', async () => {
      const server = createServer();
      const response = await supertest(server).get('/api/characters');
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers['content-type'], 'application/json');
      assert.ok(Array.isArray(response.body));
    });

    it('should handle /api/status GET correctly', async () => {
      const server = createServer();
      const response = await supertest(server).get('/api/status');
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers['content-type'], 'application/json');
      assert.strictEqual(response.body.isRunning, false);
      assert.strictEqual(response.body.currentCommand, null);
    });

    it('should handle /api/broadcast/auth/login POST', async () => {

      const mockBroadcast = new MockBroadcastService();
      const server = createServer({ broadcastService: mockBroadcast });

      const response = await supertest(server)
        .post('/api/broadcast/auth/login')
        .send({ email: 'test@test.com', password: 'pass' });
      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(response.body, { token: 'mock-token' });
    });

    it('should handle /api/broadcast/auth/login POST errors', async () => {

      const mockBroadcast = new MockBroadcastService();
      const server = createServer({ broadcastService: mockBroadcast });

      const response = await supertest(server)
        .post('/api/broadcast/auth/login')
        .send({ email: 'fail@test.com', password: 'pass' });
      assert.strictEqual(response.status, 400);
      assert.deepStrictEqual(response.body, { error: 'Login failed' });
    });

    it('should handle /api/broadcast/auth/logout POST', async () => {

      const mockBroadcast = new MockBroadcastService();
      const server = createServer({ broadcastService: mockBroadcast });

      const response = await supertest(server).post('/api/broadcast/auth/logout');
      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(response.body, { success: true });
    });

    it('should handle /api/broadcast/auth/status GET', async () => {

      const mockBroadcast = new MockBroadcastService();
      const server = createServer({ broadcastService: mockBroadcast });

      const response = await supertest(server).get('/api/broadcast/auth/status');
      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(response.body, { loggedIn: true });
    });

    it('should handle /api/broadcast/session POST', async () => {

      const mockBroadcast = new MockBroadcastService();
      const server = createServer({ broadcastService: mockBroadcast });

      const response = await supertest(server).post('/api/broadcast/session').send({});
      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(response.body, { sessionId: 'mock-session-id' });
    });

    it('should handle /api/broadcast/session GET', async () => {

      const mockBroadcast = new MockBroadcastService();
      const server = createServer({ broadcastService: mockBroadcast });

      const response = await supertest(server).get('/api/broadcast/session');
      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(response.body, { active: true });
    });

    it('should handle /api/broadcast/session DELETE', async () => {

      const mockBroadcast = new MockBroadcastService();
      const server = createServer({ broadcastService: mockBroadcast });

      const response = await supertest(server).delete('/api/broadcast/session');
      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(response.body, { success: true });
    });

    it('should handle /api/recent-games GET', async () => {
      getDatabase(':memory:');
      const server = createServer({
      broadcastService: new MockBroadcastService(),
      analyticsService: {
        getGameHabits: () => ({}),
        getPlayerHabitsProfile: () => ({})
      }
    });
      const response = await supertest(server).get('/api/recent-games');
      assert.strictEqual(response.status, 200);
      assert.ok(Array.isArray(response.body));
      closeDatabase();
    });

    it('should handle /api/pipeline/status GET', async () => {
      getDatabase(':memory:');
      const server = createServer({
      broadcastService: new MockBroadcastService(),
      analyticsService: {
        getGameHabits: () => ({}),
        getPlayerHabitsProfile: () => ({})
      }
    });
      const response = await supertest(server).get('/api/pipeline/status');
      assert.strictEqual(response.status, 200);
      assert.ok('activeCheckpoint' in response.body || response.body.activeCheckpoint === null);
      closeDatabase();
    });

    it('should handle /api/analytics/mechanics GET', async () => {
      getDatabase(':memory:');
      const server = createServer({
      broadcastService: new MockBroadcastService(),
      analyticsService: {
        getGameHabits: () => ({}),
        getPlayerHabitsProfile: () => ({})
      }
    });
      const response = await supertest(server).get('/api/analytics/mechanics');
      assert.strictEqual(response.status, 200);
      assert.ok('mechanics' in response.body);
      assert.ok('overall' in response.body);
      assert.ok('topCharacters' in response.body);
      closeDatabase();
    });

    it('should handle /api/audit/errors GET', async () => {
      getDatabase(':memory:');
      const server = createServer({
      broadcastService: new MockBroadcastService(),
      analyticsService: {
        getGameHabits: () => ({}),
        getPlayerHabitsProfile: () => ({})
      }
    });
      const response = await supertest(server).get('/api/audit/errors');
      assert.strictEqual(response.status, 200);
      assert.ok('statusCounts' in response.body);
      assert.ok('recentFailures' in response.body);
      closeDatabase();
    });

    it('should handle /api/batches GET', async () => {
      getDatabase(':memory:');
      const server = createServer({
      broadcastService: new MockBroadcastService(),
      analyticsService: {
        getGameHabits: () => ({}),
        getPlayerHabitsProfile: () => ({})
      }
    });
      const response = await supertest(server).get('/api/batches');
      assert.strictEqual(response.status, 200);
      assert.ok(Array.isArray(response.body));
      closeDatabase();
    });
  });
});
