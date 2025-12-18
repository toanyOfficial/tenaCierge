export interface GoogleAuthOptions {
  scopes?: string[];
}

export interface AccessTokenResponse {
  token: string | null;
}

export interface OAuthClient {
  getAccessToken(): Promise<string | AccessTokenResponse | null>;
}

export class GoogleAuth {
  constructor(options?: GoogleAuthOptions);
  getClient(): Promise<OAuthClient>;
  getProjectId(): Promise<string>;
}
