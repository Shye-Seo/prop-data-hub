import type { FunnelStepAggregate } from '@prop/shared';
import type { TrackedEvent } from './tracker';

export interface InspectorStage {
  key: 'capture' | 'validate' | 'buffer' | 'sink' | 'aggregate';
  label: string;
  value: string;
  hint: string;
  state: 'ok' | 'idle' | 'warn';
}

export interface InspectorSnapshot {
  stages: InspectorStage[];
  latest: TrackedEvent | null;
  recent: TrackedEvent[];
  funnel: FunnelStepAggregate[];
  totals: {
    events: number;
    sessions: number;
    rejected: number;
    queue: number;
    delivered: number;
    lastFlushAt: string | null;
    mode: 'demo' | 'api';
  };
}

export interface InspectorInput {
  events: TrackedEvent[];
  funnel: FunnelStepAggregate[];
  queueSize: number;
  rejected: number;
  delivered: number;
  lastFlushAt: string | null;
  mode: 'demo' | 'api';
  sessionId: string;
  batchSize: number;
}

/**
 * 행동 이벤트 파이프라인 인스펙터의 계산부.
 *
 * 화면(EventInspector)은 이 결과만 그린다. 단계 정의를 여기 한 곳에 두어
 * "지금 어느 단계에서 몇 건이 처리됐는가"를 테스트로 고정한다.
 * - capture: 트래커가 받은 이벤트 수(스키마 검증 대상)
 * - validate: 검증 통과/거부
 * - buffer: 아직 전송하지 않은 큐(배치 10건 또는 3초마다 flush)
 * - sink: 로컬 IndexedDB(데모) 또는 수집 API(서버 모드)
 * - aggregate: 세션 단위 퍼널 집계
 */
export function buildInspectorSnapshot(input: InspectorInput): InspectorSnapshot {
  const events = input.events;
  const sessions = new Set(events.map((event) => event.sessionId)).size;
  const latest = events.length > 0 ? events[events.length - 1]! : null;

  const stages: InspectorStage[] = [
    {
      key: 'capture',
      label: '1. 수집',
      value: `${input.delivered + input.rejected}건`,
      hint: 'tracker.track() 호출',
      state: input.delivered + input.rejected > 0 ? 'ok' : 'idle',
    },
    {
      key: 'validate',
      label: '2. 스키마 검증',
      value: `${input.delivered}건 통과 · ${input.rejected}건 제외`,
      hint: '@prop/shared zod 스키마',
      state: input.rejected > 0 ? 'warn' : input.delivered > 0 ? 'ok' : 'idle',
    },
    {
      key: 'buffer',
      label: '3. 배치 버퍼',
      value: `${input.queueSize}건 대기`,
      hint: `${input.batchSize}건 또는 3초마다 전송`,
      state: input.queueSize > 0 ? 'ok' : 'idle',
    },
    {
      key: 'sink',
      label: '4. 적재',
      value: input.mode === 'api' ? 'POST /api/v1/events' : 'IndexedDB 로컬',
      hint: input.mode === 'api' ? '서버 모드' : '데모 모드(백엔드 없음)',
      state: 'ok',
    },
    {
      key: 'aggregate',
      label: '5. 집계',
      value: `${sessions}세션`,
      hint: `퍼널 ${input.funnel.length}단계 · 최종 ${input.funnel.at(-1)?.sessions ?? 0}세션`,
      state: sessions > 0 ? 'ok' : 'idle',
    },
  ];

  return {
    stages,
    latest,
    recent: [...events].slice(-6).reverse(),
    funnel: input.funnel,
    totals: {
      events: events.length,
      sessions,
      rejected: input.rejected,
      queue: input.queueSize,
      delivered: input.delivered,
      lastFlushAt: input.lastFlushAt,
      mode: input.mode,
    },
  };
}

/** 인스펙터 JSON 패널에 보여줄 payload. eventId는 8자로 줄여 읽기 쉽게 한다. */
export function eventPayloadJson(event: TrackedEvent): string {
  return JSON.stringify(
    {
      event_id: `${event.eventId.slice(0, 8)}…`,
      name: event.name,
      occurred_at: event.occurredAt,
      received_at: event.receivedAt,
      session_id: event.sessionId,
      user_pseudo_id: event.userPseudoId,
      page: event.page,
      schema_version: event.schemaVersion,
      delivery: event.delivery,
      props: event.props,
    },
    null,
    2,
  );
}

/** 퍼널 단계별 막대 폭(%). 표본이 0이면 0을 돌려주고, 화면은 최소 폭을 따로 준다. */
export function funnelWidths(funnel: FunnelStepAggregate[]): number[] {
  const first = funnel[0]?.sessions ?? 0;
  return funnel.map((step) => (first === 0 ? 0 : Math.round((step.sessions / first) * 100)));
}
