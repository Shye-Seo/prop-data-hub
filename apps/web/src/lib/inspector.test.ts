import { describe, expect, it } from 'vitest';
import { computeFunnel } from '@prop/shared';
import { buildInspectorSnapshot, eventPayloadJson, funnelWidths } from './inspector';
import type { TrackedEvent } from './tracker';

function event(partial: Partial<TrackedEvent> & Pick<TrackedEvent, 'name'>): TrackedEvent {
  return {
    eventId: 'evt-0000-0000-0000-000000000001',
    occurredAt: '2026-11-20T01:00:00.000Z',
    receivedAt: '2026-11-20T01:00:00.010Z',
    sessionId: 'sess-00000001',
    userPseudoId: 'user-00000001',
    page: '/overview',
    props: {},
    schemaVersion: '1.2.0',
    delivery: 'local',
    ...partial,
  };
}

const events: TrackedEvent[] = [
  event({ name: 'page_view', eventId: 'e1', props: { route: '/overview' } }),
  event({ name: 'region_filter_change', eventId: 'e2', props: { lawdCd: '26290', dong: '문현동', areaBand: 'all', periodMonths: 12 } }),
  event({
    name: 'listing_click',
    eventId: 'e3',
    props: { complexId: 'MOLIT-26290-001', aptName: '문현베스티움', priceKrw: 628_000_000, areaM2: 84.98, source: 'explore_table' },
  }),
];

describe('buildInspectorSnapshot', () => {
  it('수집·검증·버퍼·적재·집계 5단계를 만든다', () => {
    const snapshot = buildInspectorSnapshot({
      events,
      funnel: computeFunnel(events),
      queueSize: 3,
      rejected: 1,
      delivered: 3,
      lastFlushAt: '2026-11-20T01:00:03.000Z',
      mode: 'demo',
      sessionId: 'sess-00000001',
      batchSize: 10,
    });
    expect(snapshot.stages.map((stage) => stage.key)).toEqual(['capture', 'validate', 'buffer', 'sink', 'aggregate']);
    expect(snapshot.stages[0]?.value).toBe('4건');
    expect(snapshot.stages[1]?.value).toBe('3건 통과 · 1건 제외');
    expect(snapshot.stages[1]?.state).toBe('warn');
    expect(snapshot.stages[2]?.value).toBe('3건 대기');
    expect(snapshot.stages[3]?.value).toBe('IndexedDB 로컬');
    expect(snapshot.stages[4]?.value).toBe('1세션');
    expect(snapshot.totals.events).toBe(3);
    expect(snapshot.totals.sessions).toBe(1);
    expect(snapshot.latest?.eventId).toBe('e3');
    expect(snapshot.recent.map((row) => row.eventId)).toEqual(['e3', 'e2', 'e1']);
  });

  it('이벤트가 없으면 최신 이벤트가 null이고 단계가 idle이다', () => {
    const snapshot = buildInspectorSnapshot({
      events: [],
      funnel: computeFunnel([]),
      queueSize: 0,
      rejected: 0,
      delivered: 0,
      lastFlushAt: null,
      mode: 'api',
      sessionId: 'sess-00000002',
      batchSize: 10,
    });
    expect(snapshot.latest).toBeNull();
    expect(snapshot.recent).toEqual([]);
    expect(snapshot.stages[0]?.state).toBe('idle');
    expect(snapshot.stages[3]?.value).toBe('POST /api/v1/events');
  });

  it('payload JSON은 DB 컬럼명에 맞춘 키로 보여준다', () => {
    const json = JSON.parse(eventPayloadJson(events[2]!));
    expect(json.name).toBe('listing_click');
    expect(json.schema_version).toBe('1.2.0');
    expect(json.props.complexId).toBe('MOLIT-26290-001');
    expect(json.event_id).toContain('…');
  });

  it('퍼널 막대 폭은 첫 단계 대비 비율이다', () => {
    const funnel = computeFunnel([
      ...events,
      event({ name: 'complex_compare_add', eventId: 'e4', props: { complexIds: ['MOLIT-26290-001'], addedComplexId: 'MOLIT-26290-001', compareCount: 1 } }),
    ]);
    const widths = funnelWidths(funnel);
    expect(widths[0]).toBe(100);
    expect(widths[2]).toBe(100);
    expect(widths[3]).toBe(0);
  });
});
