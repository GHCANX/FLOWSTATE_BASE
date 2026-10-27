import fs from 'node:fs';
import path from 'node:path';

export const SLIPPI_FIREBASE_API_KEY = process.env.SLIPPI_FIREBASE_API_KEY || '';
export const FIREBASE_SIGNIN_URL = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${SLIPPI_FIREBASE_API_KEY}`;
export const FIREBASE_REFRESH_URL = `https://securetoken.googleapis.com/v1/token?key=${SLIPPI_FIREBASE_API_KEY}`;
export const SLIPPI_GRAPHQL_URL = 'https://slippi.gg/graphql';

export class SlippiAuthClient {
  /**
   * @param {Object} [options]
   * @param {string} [options.credentialsPath]
   * @param {string} [options.firebaseSignInUrl]
   * @param {string} [options.firebaseRefreshUrl]
   * @param {string} [options.slippiGraphqlUrl]
   */
  constructor(options = {}) {
    this.credentialsPath = options.credentialsPath || path.resolve(process.cwd(), 'data/slippi_credentials.json');
    this.firebaseSignInUrl = options.firebaseSignInUrl || FIREBASE_SIGNIN_URL;
    this.firebaseRefreshUrl = options.firebaseRefreshUrl || FIREBASE_REFRESH_URL;
    this.slippiGraphqlUrl = options.slippiGraphqlUrl || SLIPPI_GRAPHQL_URL;

    this.idToken = null;
    this.refreshToken = null;
    this.expiresAt = null; // unix ms timestamp
    this.fbUid = null;
    this.email = null;
    this.displayName = null;
    this.connectCode = null;

    // Load any existing credentials on startup
    this.loadFromDisk();
  }

  /**
   * Check if client currently has a valid session
   * @returns {boolean}
   */
  isAuthenticated() {
    return Boolean(this.fbUid && (this.idToken || this.refreshToken));
  }

  /**
   * Get public credential summary
   * @returns {Object}
   */
  getCredentialsSummary() {
    return {
      authenticated: this.isAuthenticated(),
      uid: this.fbUid,
      email: this.email,
      displayName: this.displayName || this.email || 'Slippi User',
      connectCode: this.connectCode || null,
      expiresAt: this.expiresAt,
    };
  }

  /**
   * Load credentials from local secure file if exists
   */
  loadFromDisk() {
    try {
      if (fs.existsSync(this.credentialsPath)) {
        const raw = fs.readFileSync(this.credentialsPath, 'utf8');
        const data = JSON.parse(raw);
        this.fbUid = data.fbUid || null;
        this.refreshToken = data.refreshToken || null;
        this.idToken = data.idToken || null;
        this.expiresAt = data.expiresAt || null;
        this.email = data.email || null;
        this.displayName = data.displayName || null;
        this.connectCode = data.connectCode || null;
      }
    } catch (err) {
      console.warn('[SlippiAuthClient] Failed to load credentials from disk:', err.message);
    }
  }

  /**
   * Save current credentials to local file
   */
  saveToDisk() {
    try {
      const dir = path.dirname(this.credentialsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = {
        fbUid: this.fbUid,
        refreshToken: this.refreshToken,
        idToken: this.idToken,
        expiresAt: this.expiresAt,
        email: this.email,
        displayName: this.displayName,
        connectCode: this.connectCode,
        updatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(this.credentialsPath, JSON.stringify(data, null, 2), { mode: 0o600 });
    } catch (err) {
      console.warn('[SlippiAuthClient] Failed to persist credentials to disk:', err.message);
    }
  }

  /**
   * Log in with Slippi email and password via Firebase Auth
   * @param {string} email
   * @param {string} password
   * @returns {Promise<Object>}
   */
  async login(email, password) {
    if (!email || !password) {
      throw new Error('Email and password are required');
    }

    const payload = {
      email: email.trim(),
      password,
      returnSecureToken: true,
    };

    const res = await fetch(this.firebaseSignInUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      let errMsg = `Firebase auth failed with status ${res.status}`;
      try {
        const errJson = await res.json();
        if (errJson.error && errJson.error.message) {
          errMsg = errJson.error.message;
        }
      } catch (_) {}
      throw new Error(errMsg);
    }

    const data = await res.json();
    this.fbUid = data.localId;
    this.idToken = data.idToken;
    this.refreshToken = data.refreshToken;
    this.email = data.email || email;

    const expiresInSec = parseInt(data.expiresIn || '3600', 10);
    this.expiresAt = Date.now() + expiresInSec * 1000;

    // Fetch user profile from Slippi GraphQL if possible
    await this._fetchUserProfile();

    // Persist
    this.saveToDisk();

    return this.getCredentialsSummary();
  }

  /**
   * Refresh the ID token using refresh_token
   * @returns {Promise<string>} Fresh idToken
   */
  async refresh() {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }

    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', this.refreshToken);

    const res = await fetch(this.firebaseRefreshUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!res.ok) {
      let errMsg = `Token refresh failed with status ${res.status}`;
      try {
        const errJson = await res.json();
        if (errJson.error && errJson.error.message) {
          errMsg = errJson.error.message;
        }
      } catch (_) {}
      throw new Error(errMsg);
    }

    const data = await res.json();
    this.idToken = data.id_token;
    if (data.refresh_token) {
      this.refreshToken = data.refresh_token;
    }
    if (data.user_id) {
      this.fbUid = data.user_id;
    }
    const expiresInSec = parseInt(data.expires_in || '3600', 10);
    this.expiresAt = Date.now() + expiresInSec * 1000;

    this.saveToDisk();
    return this.idToken;
  }

  /**
   * Returns a valid ID token, refreshing if within 5 minutes of expiration
   * @returns {Promise<string>}
   */
  async getValidIdToken() {
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated. Please log in with a Slippi account.');
    }

    const fiveMinutes = 5 * 60 * 1000;
    const now = Date.now();

    if (!this.idToken || !this.expiresAt || this.expiresAt - now < fiveMinutes) {
      if (this.refreshToken) {
        return await this.refresh();
      }
    }

    return this.idToken;
  }

  /**
   * Query Slippi GraphQL for user connect code and display name
   * @private
   */
  async _fetchUserProfile() {
    if (!this.fbUid) return;

    try {
      const query = `
        query GetUser($fbUid: String!) {
          getUser(fbUid: $fbUid) {
            displayName
            connectCode {
              code
            }
          }
        }
      `;

      const headers = {
        'Content-Type': 'application/json',
      };
      if (this.idToken) {
        headers['Authorization'] = `Bearer ${this.idToken}`;
      }

      const res = await fetch(this.slippiGraphqlUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query,
          variables: { fbUid: this.fbUid },
        }),
      });

      if (res.ok) {
        const json = await res.json();
        if (json.data && json.data.getUser) {
          const user = json.data.getUser;
          this.displayName = user.displayName || this.displayName;
          if (user.connectCode && user.connectCode.code) {
            this.connectCode = user.connectCode.code;
          }
        }
      }
    } catch (err) {
      // Non-fatal profile lookup error
      console.warn('[SlippiAuthClient] Could not fetch profile from GraphQL:', err.message);
    }
  }

  /**
   * Clear session and remove credentials
   */
  logout() {
    this.idToken = null;
    this.refreshToken = null;
    this.expiresAt = null;
    this.fbUid = null;
    this.email = null;
    this.displayName = null;
    this.connectCode = null;

    try {
      if (fs.existsSync(this.credentialsPath)) {
        fs.unlinkSync(this.credentialsPath);
      }
    } catch (_) {}

    return { success: true };
  }
}

let globalSlippiAuth = null;

export function getSlippiAuth(options) {
  if (!globalSlippiAuth) {
    globalSlippiAuth = new SlippiAuthClient(options);
  }
  return globalSlippiAuth;
}

export function resetSlippiAuth() {
  if (globalSlippiAuth) {
    globalSlippiAuth.logout();
    globalSlippiAuth = null;
  }
}
