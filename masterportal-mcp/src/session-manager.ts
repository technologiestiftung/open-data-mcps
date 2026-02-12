// ABOUTME: Manages portal sessions with layers and map configuration
// ABOUTME: Sessions expire after 10 minutes of inactivity

import { PortalSession, Layer, MapConfig } from './types.js';

const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

const DEFAULT_MAP_CONFIG: MapConfig = {
  title: 'Masterportal',
  center: [13.4, 52.52], // Berlin center
  zoom: 10,
};

export class SessionManager {
  private sessions: Map<string, PortalSession> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Run cleanup every minute
    this.cleanupInterval = setInterval(() => this.cleanupExpiredSessions(), 60 * 1000);
  }

  getOrCreateSession(sessionId: string): PortalSession {
    let session = this.sessions.get(sessionId);

    if (!session) {
      session = {
        id: sessionId,
        layers: [],
        mapConfig: { ...DEFAULT_MAP_CONFIG },
        createdAt: new Date(),
        lastAccessedAt: new Date(),
      };
      this.sessions.set(sessionId, session);
      console.error(`Created new session: ${sessionId}`);
    } else {
      session.lastAccessedAt = new Date();
    }

    return session;
  }

  addLayer(sessionId: string, layer: Layer): void {
    const session = this.getOrCreateSession(sessionId);

    // Replace existing layer with same ID, or add new
    const existingIndex = session.layers.findIndex(l => l.id === layer.id);
    if (existingIndex >= 0) {
      session.layers[existingIndex] = layer;
      console.error(`Updated layer ${layer.id} in session ${sessionId}`);
    } else {
      session.layers.push(layer);
      console.error(`Added layer ${layer.id} to session ${sessionId}`);
    }
  }

  updateMapConfig(sessionId: string, config: Partial<MapConfig>): void {
    const session = this.getOrCreateSession(sessionId);
    session.mapConfig = { ...session.mapConfig, ...config };
    console.error(`Updated map config for session ${sessionId}`);
  }

  getSession(sessionId: string): PortalSession | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastAccessedAt = new Date();
    }
    return session;
  }

  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    console.error(`Cleared session: ${sessionId}`);
  }

  private cleanupExpiredSessions(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, session] of this.sessions) {
      if (now - session.lastAccessedAt.getTime() > SESSION_TIMEOUT_MS) {
        this.sessions.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.error(`Cleaned up ${cleaned} expired sessions`);
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.sessions.clear();
  }
}
