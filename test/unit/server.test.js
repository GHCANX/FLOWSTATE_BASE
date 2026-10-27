import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { EventEmitter } from 'node:events';
import { parseJsonBody, createServer } from '../../src/server/server.js';

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
  });

  describe('Broadcast Routes', () => {
    let server;
    beforeEach(() => {
      const mockBroadcast = new EventEmitter();
      mockBroadcast.auth = {
        login: async (email, password) => {
          if (email === 'test@example.com') return { token: 'mock-token' };
          throw new Error('Invalid');
        },
        logout: () => ({ success: true }),
        getCredentialsSummary: () => ({ status: 'logged_in' })
      };
      mockBroadcast.startSession = async (body) => ({ sessionId: '123' });
      mockBroadcast.getSession = () => ({ sessionId: '123' });
      mockBroadcast.stopSession = async () => ({ success: true });
      mockBroadcast.watchBroadcast = (id) => {};

      server = createServer({ broadcastService: mockBroadcast });
    });

    it('should handle /api/broadcast/auth/login POST', async () => {
      const response = await supertest(server)
        .post('/api/broadcast/auth/login')
        .send({ email: 'test@example.com', password: 'password' });
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.token, 'mock-token');

      const errorResponse = await supertest(server)
        .post('/api/broadcast/auth/login')
        .send({ email: 'bad@example.com', password: 'password' });
      assert.strictEqual(errorResponse.status, 400);
    });

    it('should handle /api/broadcast/auth/logout POST', async () => {
      const response = await supertest(server).post('/api/broadcast/auth/logout');
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
    });

    it('should handle /api/broadcast/auth/status GET', async () => {
      const response = await supertest(server).get('/api/broadcast/auth/status');
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.status, 'logged_in');
    });

    it('should handle /api/broadcast/session POST', async () => {
      const response = await supertest(server).post('/api/broadcast/session').send({});
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.sessionId, '123');
    });

    it('should handle /api/broadcast/session GET', async () => {
      const response = await supertest(server).get('/api/broadcast/session');
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.sessionId, '123');
    });

    it('should handle /api/broadcast/session DELETE', async () => {
      const response = await supertest(server).delete('/api/broadcast/session');
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
    });

    it('should handle /api/broadcast/watch POST', async () => {
      const response = await supertest(server).post('/api/broadcast/watch').send({ id: 'some-id' });
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.watching, 'some-id');
    });

    it('should handle /api/broadcast/events GET', async () => {
      const request = supertest(server).get('/api/broadcast/events');
      request.end((err, res) => {
          assert.strictEqual(res.status, 200);
          assert.strictEqual(res.headers['content-type'], 'text/event-stream');
      });
      setTimeout(() => request.abort(), 50);
    });
  });

});
