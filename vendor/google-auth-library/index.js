const fs = require('fs');
const crypto = require('crypto');

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt(header, payload, privateKey) {
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const data = `${encodedHeader}.${encodedPayload}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(data);
  signer.end();
  const signature = signer.sign(privateKey);
  return `${data}.${base64UrlEncode(signature)}`;
}

class JWTClient {
  constructor(options) {
    this.clientEmail = options.clientEmail;
    this.privateKey = options.privateKey;
    this.scopes = options.scopes;
    this.tokenUri = options.tokenUri || 'https://oauth2.googleapis.com/token';
  }

  async getAccessToken() {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: this.clientEmail,
      scope: Array.isArray(this.scopes) ? this.scopes.join(' ') : '',
      aud: this.tokenUri,
      iat: now,
      exp: now + 3600
    };

    const assertion = signJwt({ alg: 'RS256', typ: 'JWT' }, payload, this.privateKey);
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    });

    const response = await fetch(this.tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });

    const responseBody = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = responseBody.error_description || responseBody.error || response.statusText;
      throw new Error(message || 'Failed to retrieve access token');
    }

    const token = responseBody.access_token;
    if (!token) {
      throw new Error('Access token not found in response');
    }

    return token;
  }
}

class GoogleAuth {
  constructor(options = {}) {
    this.scopes = options.scopes || [];
  }

  async getClient() {
    const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!credentialPath) {
      throw new Error('GOOGLE_APPLICATION_CREDENTIALS 환경 변수를 설정해 주세요.');
    }

    const raw = await fs.promises.readFile(credentialPath, 'utf8');
    const credentials = JSON.parse(raw);
    const clientEmail = credentials.client_email;
    const privateKey = credentials.private_key;
    const tokenUri = credentials.token_uri;

    if (!clientEmail || !privateKey) {
      throw new Error('서비스 계정 JSON에서 client_email 또는 private_key를 찾을 수 없습니다.');
    }

    return new JWTClient({ clientEmail, privateKey, scopes: this.scopes, tokenUri });
  }

  async getProjectId() {
    const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!credentialPath) {
      throw new Error('GOOGLE_APPLICATION_CREDENTIALS 환경 변수를 설정해 주세요.');
    }

    const raw = await fs.promises.readFile(credentialPath, 'utf8');
    const credentials = JSON.parse(raw);
    if (!credentials.project_id) {
      throw new Error('서비스 계정 JSON에서 project_id를 찾을 수 없습니다.');
    }

    return credentials.project_id;
  }
}

module.exports = { GoogleAuth };
