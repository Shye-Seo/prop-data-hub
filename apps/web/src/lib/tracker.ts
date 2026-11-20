import {
  EVENT_SCHEMA_VERSION,
  computeFunnel,
  validateBehaviorEvent,
  type EventName,
  type FunnelStepAggregate,
} from '@prop/shared';

export interface TrackedEvent {
  eventId: string;
  name: EventName;
  occurredAt: string;
  receivedAt: string;
  sessionId: string;
  userPseudoId: string;
  page: string;
  props: Record<string, unknown>;
  schemaVersion: string;
  delivery: 'local' | 'pending' | 'api' | 'rejected';
}

type Listener = () => void;

const SESSION_KEY = 'prop.sessionId';
const USER_KEY = 'prop.userPseudoId';
const DB_NAME = 'prop-analytics';
const STORE_NAME = 'events';
const BATCH_SIZE = 10;
const FLUSH_INTERVAL_MS = 3_000;

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = (Math.random() * 16) | 0;
    return (char === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });
}

function readStorage(storage: Storage | undefined, key: string, prefix: string): string {
  try {
    const existing = storage?.getItem(key);
    if (existing) return existing;
    const created = `${prefix}-${randomId().slice(0, 12)}`;
    storage?.setItem(key, created);
    return created;
  } catch {
    return `${prefix}-${randomId().slice(0, 12)}`;
  }
}

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'eventId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

/**
 * 프론트엔드 경량 트래커.
 *
 * - 이벤트는 큐에 모아 10건 또는 3초마다 배치 전송한다(요청 수를 줄이기 위해).
 * - 페이지를 떠날 때는 sendBeacon으로 남은 큐를 보낸다.
 * - 데모 모드(VITE_API_BASE 없음)에서는 인메모리 스트림 + IndexedDB에 적재해
 *   새로고침 후에도 이벤트 뷰어가 같은 데이터를 보여준다.
 * - 전송 전에 @prop/shared의 스키마로 검증하고, 거부된 이벤트는 카운트만 남긴다.
 */
export class AnalyticsTracker {
  readonly sessionId: string;
  readonly userPseudoId: string;
  private queue: TrackedEvent[] = [];
  private events: TrackedEvent[] = [];
  private listeners = new Set<Listener>();
  private timer: number | null = null;
  private db: IDBDatabase | null = null;
  private dbReady: Promise<void>;
  private readonly endpoint: string | null;

  delivered = 0;
  rejected = 0;
  lastFlushAt: string | null = null;
  mode: 'demo' | 'api';
  readonly batchSize = BATCH_SIZE;
  readonly flushIntervalMs = FLUSH_INTERVAL_MS;

  constructor() {
    const apiBase = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '');
    this.endpoint = apiBase ? `${apiBase}/api/v1/events` : null;
    this.mode = this.endpoint ? 'api' : 'demo';
    this.sessionId = readStorage(safeStorage('sessionStorage'), SESSION_KEY, 'sess');
    this.userPseudoId = readStorage(safeStorage('localStorage'), USER_KEY, 'user');
    this.dbReady = this.hydrate();
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => this.flushWithBeacon());
      window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.flushWithBeacon();
      });
    }
  }

  private async hydrate(): Promise<void> {
    const db = await openDatabase();
    this.db = db;
    if (!db) return;
    await new Promise<void>((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => {
        const rows = (request.result as TrackedEvent[])
          .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
          .slice(-300);
        const known = new Set(this.events.map((event) => event.eventId));
        for (const row of rows) if (!known.has(row.eventId)) this.events.push(row);
        this.events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
        this.notify();
        resolve();
      };
      request.onerror = () => resolve();
    });
  }

  private persist(event: TrackedEvent): void {
    if (!this.db) return;
    try {
      const transaction = this.db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(event);
    } catch {
      // 저장 실패는 수집 흐름을 막지 않는다(메모리 스트림은 유지).
    }
  }

  track(name: EventName, props: Record<string, unknown>, page?: string): TrackedEvent | null {
    const candidate = {
      eventId: randomId(),
      name,
      occurredAt: new Date().toISOString(),
      sessionId: this.sessionId,
      userPseudoId: this.userPseudoId,
      page: page ?? (typeof window !== 'undefined' ? window.location.hash.replace('#', '') || '/overview' : '/overview'),
      props,
    };

    const validation = validateBehaviorEvent(candidate);
    if (!validation.ok) {
      this.rejected += 1;
      if (import.meta.env.DEV) {
        console.warn('[analytics] 이벤트가 스키마 검증에서 제외됨', name, validation.errors);
      }
      return null;
    }

    const event: TrackedEvent = {
      ...candidate,
      receivedAt: new Date().toISOString(),
      schemaVersion: EVENT_SCHEMA_VERSION,
      delivery: this.endpoint ? 'pending' : 'local',
    };

    this.queue.push(event);
    this.events.push(event);
    this.persist(event);
    this.delivered += 1;
    this.notify();

    if (this.queue.length >= BATCH_SIZE) void this.flush();
    else this.scheduleFlush();
    return event;
  }

  private scheduleFlush(): void {
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, FLUSH_INTERVAL_MS);
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.queue.length);
    this.lastFlushAt = new Date().toISOString();

    if (!this.endpoint) {
      // 데모: 로컬 적재만으로 전송 완료로 본다(IndexedDB에 이미 기록됨).
      this.notify();
      return;
    }

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ events: batch, appEnv: 'preview' }),
        keepalive: true,
      });
      if (!response.ok && response.status !== 207) throw new Error(`HTTP ${response.status}`);
      this.notify();
    } catch {
      // 실패한 배치는 큐 선두로 되돌려 다음 flush에서 재시도한다.
      this.queue.unshift(...batch);
    }
  }

  private flushWithBeacon(): void {
    if (this.endpoint && this.queue.length > 0 && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const payload = JSON.stringify({ events: this.queue, appEnv: 'preview' });
      navigator.sendBeacon(this.endpoint, new Blob([payload], { type: 'application/json' }));
      this.queue = [];
      return;
    }
    void this.flush();
  }

  getEvents(): TrackedEvent[] {
    return [...this.events];
  }

  getRecent(limit = 20): TrackedEvent[] {
    return this.events.slice(-limit).reverse();
  }

  /** 아직 전송하지 않은 큐 길이. 인스펙터의 배치 버퍼 단계가 쓴다. */
  getQueueSize(): number {
    return this.queue.length;
  }

  getFunnel(): FunnelStepAggregate[] {
    return computeFunnel(
      this.events.map((event) => ({
        name: event.name,
        occurredAt: event.occurredAt,
        sessionId: event.sessionId,
        userPseudoId: event.userPseudoId,
        page: event.page,
        props: event.props,
      })),
    );
  }

  countsByName(): Array<{ name: string; count: number }> {
    const counts = new Map<string, number>();
    for (const event of this.events) counts.set(event.name, (counts.get(event.name) ?? 0) + 1);
    return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  /** E2E·디버그용: 로컬 이벤트 스트림을 비운다. */
  reset(): void {
    this.events = [];
    this.queue = [];
    this.delivered = 0;
    this.rejected = 0;
    this.notify();
  }

  async ready(): Promise<void> {
    await this.dbReady;
  }
}

function safeStorage(kind: 'localStorage' | 'sessionStorage'): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window[kind];
  } catch {
    return undefined;
  }
}

export const tracker = new AnalyticsTracker();

declare global {
  interface Window {
    __propAnalytics?: {
      tracker: AnalyticsTracker;
      track: (name: EventName, props: Record<string, unknown>) => void;
      getEvents: () => TrackedEvent[];
      funnel: () => FunnelStepAggregate[];
      reset: () => void;
      sessionId: string;
    };
  }
}

if (typeof window !== 'undefined') {
  window.__propAnalytics = {
    tracker,
    track: (name, props) => {
      tracker.track(name, props);
    },
    getEvents: () => tracker.getEvents(),
    funnel: () => tracker.getFunnel(),
    reset: () => tracker.reset(),
    sessionId: tracker.sessionId,
  };
}
