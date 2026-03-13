import { randomBytes } from "node:crypto";

/**
 * Auth session for headless clients.
 * This allows the server to coordinate between:
 * 1. The initiating client (remote Droid)
 * 2. The browser-based authorization flow (user's laptop)
 * 3. The final token handoff back to the client
 */
export interface AuthSession {
  sessionId: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state?: string;
  qboState?: string;
  createdAt: number;
  expiresAt: number;
  status: "pending" | "completed" | "redeemed" | "expired";
  // The final MCP JWT will be stored here after successful OAuth
  mcpToken?: string;
  // One-time code for the user to copy/paste
  oneTimeCode?: string;
}

/**
 * In-memory store for auth sessions.
 * Sessions are short-lived (5-10 minutes) and cleaned up after use.
 */
export class AuthSessionStore {
  private sessions: Map<string, AuthSession>;
  private codeIndex: Map<string, string>; // oneTimeCode -> sessionId
  private readonly SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes
  private readonly CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes for code redemption

  constructor() {
    this.sessions = new Map();
    this.codeIndex = new Map();
  }

  /**
   * Create a new auth session for a headless client.
   */
  createSession(params: {
    clientId: string;
    redirectUri: string;
    scopes: string[];
    state?: string;
  }): AuthSession {
    const sessionId = this.generateSessionId();
    const now = Date.now();

    const session: AuthSession = {
      sessionId,
      clientId: params.clientId,
      redirectUri: params.redirectUri,
      scopes: params.scopes,
      state: params.state,
      createdAt: now,
      expiresAt: now + this.SESSION_TTL_MS,
      status: "pending",
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Get a session by ID.
   */
  getSession(sessionId: string): AuthSession | undefined {
    const session = this.sessions.get(sessionId);
    if (session && session.expiresAt > Date.now() && session.status !== "expired") {
      return session;
    }
    // Clean up expired
    if (session) {
      this.sessions.delete(sessionId);
    }
    return undefined;
  }

  /**
   * Get a session by one-time code.
   */
  getSessionByCode(oneTimeCode: string): AuthSession | undefined {
    const sessionId = this.codeIndex.get(oneTimeCode);
    if (!sessionId) return undefined;
    return this.getSession(sessionId);
  }

  /**
   * Mark a session as awaiting browser authorization.
   * Stores the QBO state for the callback lookup.
   */
  setQBOState(sessionId: string, qboState: string): void {
    const session = this.getSession(sessionId);
    if (session) {
      session.qboState = qboState;
    }
  }

  /**
   * Get session by QBO state (for callback lookup).
   */
  getSessionByQBOState(qboState: string): AuthSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.qboState === qboState && session.status === "pending") {
        return session;
      }
    }
    return undefined;
  }

  /**
   * Complete the session with the MCP token.
   * Returns a one-time code that the user can copy/paste.
   */
  completeSession(sessionId: string, mcpToken: string): string {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error("Session not found or expired");
    }

    if (session.status !== "pending") {
      throw new Error("Session already completed or redeemed");
    }

    // Generate a short-lived code that must be redeemed with the original session ID.
    const oneTimeCode = this.generateOneTimeCode();
    
    session.mcpToken = mcpToken;
    session.oneTimeCode = oneTimeCode;
    session.status = "completed";
    session.expiresAt = Date.now() + this.CODE_TTL_MS; // Extend expiry for code redemption

    // Index by code for lookup
    this.codeIndex.set(oneTimeCode, sessionId);

    return oneTimeCode;
  }

  /**
   * Redeem a one-time code for the MCP token.
   * This is called by the headless client after user pastes the code.
   */
  redeemCode(sessionId: string, oneTimeCode: string): string {
    const session = this.getSessionByCode(oneTimeCode);
    if (!session) {
      throw new Error("Invalid or expired code");
    }

    if (session.sessionId !== sessionId) {
      throw new Error("Code does not match session");
    }

    if (session.status !== "completed") {
      throw new Error("Session not ready for redemption");
    }

    // Mark as redeemed and clean up
    session.status = "redeemed";
    const token = session.mcpToken!;
    session.oneTimeCode = undefined;
    session.qboState = undefined;
    
    // Clean up the code index
    this.codeIndex.delete(oneTimeCode);
    
    // Clean up the session after a short delay to allow for any final checks
    setTimeout(() => {
      this.sessions.delete(session.sessionId);
    }, 60000);

    return token;
  }

  /**
   * Expire a session.
   */
  expireSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = "expired";
    }
  }

  /**
   * Clean up expired sessions and codes.
   */
  cleanup(): void {
    const now = Date.now();
    
    // Clean up expired sessions
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expiresAt < now || session.status === "redeemed") {
        this.sessions.delete(sessionId);
      }
    }

    // Clean up code index entries for expired sessions
    for (const [code, sessionId] of this.codeIndex.entries()) {
      const session = this.sessions.get(sessionId);
      if (!session || session.status === "redeemed") {
        this.codeIndex.delete(code);
      }
    }
  }

  private generateSessionId(): string {
    return randomBytes(24).toString("base64url");
  }

  private generateOneTimeCode(): string {
    return randomBytes(8).toString("hex").toUpperCase();
  }
}

// Singleton instance
export const authSessionStore = new AuthSessionStore();
