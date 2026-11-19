import { useEffect, useState } from 'react';
import { ROUTES, useRoute, type RouteKey } from './lib/router';
import { tracker } from './lib/tracker';
import { SAMPLE_END_MONTH } from '@prop/shared';
import Overview from './pages/Overview';
import Explore from './pages/Explore';
import Compare from './pages/Compare';
import RateLab from './pages/RateLab';
import Pipeline from './pages/Pipeline';
import Events from './pages/Events';
import Dictionary from './pages/Dictionary';

const ROUTE_TITLES: Record<RouteKey, { title: string; description: string }> = {
  overview: { title: '시장 개요', description: '부산 남구·해운대구 실거래와 금리 지표를 한 화면에서 봅니다.' },
  explore: { title: '실거래 탐색', description: '지역·단지·면적·기간으로 실거래를 좁히고 평당가를 비교합니다.' },
  compare: { title: '단지 비교', description: '최대 3개 단지의 가격 추이와 거래량을 같은 축에서 비교합니다.' },
  rate: { title: '금리 민감도', description: '대출 조건을 바꾸며 월 상환액과 필요 소득(DSR)을 계산합니다.' },
  pipeline: { title: '수집 파이프라인', description: '공공데이터 수집 실행, 실패 재시도, 데이터 기준일을 확인합니다.' },
  events: { title: '행동 이벤트', description: '이 화면에서 발생한 이벤트와 퍼널 전환을 실시간으로 봅니다.' },
  dictionary: { title: '지표 정의서', description: '이벤트·퍼널·데이터 품질 규칙을 정의 단위로 정리했습니다.' },
};

export default function App() {
  const [route, navigate] = useRoute();
  const [eventCount, setEventCount] = useState(0);

  useEffect(() => {
    tracker.track('page_view', {
      route: `/${route}`,
      isInitialLoad: tracker.getEvents().filter((event) => event.name === 'page_view').length === 0,
      deviceType: window.innerWidth < 640 ? 'mobile' : window.innerWidth < 1024 ? 'tablet' : 'desktop',
      referrer: document.referrer ? new URL(document.referrer).host : undefined,
    });
  }, [route]);

  useEffect(() => tracker.subscribe(() => setEventCount(tracker.getEvents().length)), []);

  const meta = ROUTE_TITLES[route];

  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-ink-700/40 bg-ink-900 px-4 py-6 text-slate-200 lg:flex">
        <BrandMark />
        <nav className="mt-7 space-y-1" aria-label="주요 화면">
          {ROUTES.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => navigate(item.key)}
              aria-current={route === item.key ? 'page' : undefined}
              className={`group flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition ${
                route === item.key ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'
              }`}
            >
              <span
                className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                  route === item.key ? 'bg-teal-400' : 'bg-slate-600 group-hover:bg-slate-400'
                }`}
              />
              <span>
                <span className="block text-[13px] font-semibold">{item.label}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-slate-400">{item.description}</span>
              </span>
            </button>
          ))}
        </nav>
        <div className="mt-auto space-y-2 pt-6 text-[11px] leading-relaxed text-slate-400">
          <p className="rounded-lg bg-white/5 px-3 py-2">
            데이터 기준월 <span className="num text-slate-200">{SAMPLE_END_MONTH}</span>
            <br />
            실거래 신고 지연 1~2개월 반영
          </p>
          <p>
            샘플 데이터 ·{' '}
            <button type="button" className="underline decoration-dotted" onClick={() => navigate('dictionary')}>
              범위 보기
            </button>
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
            <div className="lg:hidden">
              <BrandMark compact />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-base font-semibold text-ink-900 sm:text-lg">{meta.title}</h1>
              <p className="hidden truncate text-xs text-slate-500 sm:block">{meta.description}</p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="hidden items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-[11px] font-semibold text-teal-700 sm:inline-flex"
                title="백엔드 없이 브라우저에서 동작하는 데모 모드입니다."
              >
                <span className="h-1.5 w-1.5 rounded-full bg-teal-500" />
                데모 모드
              </span>
              <button type="button" onClick={() => navigate('events')} className="chip" aria-label="수집된 행동 이벤트 보기">
                이벤트 <span className="num font-semibold text-ink-800" data-testid="event-count">{eventCount}</span>건
              </button>
            </div>
          </div>

          <nav className="flex gap-1 overflow-x-auto border-t border-slate-100 px-3 py-2 lg:hidden" aria-label="화면 이동">
            {ROUTES.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => navigate(item.key)}
                aria-current={route === item.key ? 'page' : undefined}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ${
                  route === item.key ? 'bg-ink-800 text-white' : 'text-slate-600'
                }`}
              >
                {item.short}
              </button>
            ))}
          </nav>
        </header>

        <main className="mx-auto w-full max-w-[1180px] flex-1 px-4 py-5 sm:px-6 sm:py-7">
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
            <span className="font-semibold">샘플 데이터</span>
            <span className="text-amber-800">
              단지명·준공연도·세대수는 공개 정보 기준이고, 거래 금액·층·계약일은 화면 검증용 대표 표본입니다. 실제 거래 내역이 아닙니다.
            </span>
          </div>

          {route === 'overview' && <Overview navigate={navigate} />}
          {route === 'explore' && <Explore />}
          {route === 'compare' && <Compare />}
          {route === 'rate' && <RateLab />}
          {route === 'pipeline' && <Pipeline />}
          {route === 'events' && <Events />}
          {route === 'dictionary' && <Dictionary />}

          <footer className="mt-10 border-t border-slate-200 pt-4 text-[11px] leading-relaxed text-slate-400">
            prop-data-hub · TypeScript · React · Node.js · PostgreSQL · AWS 설계 문서 포함 · API 명세(OpenAPI 3.0)는 로컬 API
            서버의 /api-docs에서 확인합니다.
          </footer>
        </main>
      </div>
    </div>
  );
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500/15 text-sm font-bold text-teal-300 ring-1 ring-teal-400/30">
        집
      </span>
      <span>
        <span className="block text-sm font-semibold tracking-tight text-white">prop-data-hub</span>
        {!compact && <span className="block text-[11px] text-slate-400">부동산 데이터 해독 콘솔</span>}
      </span>
    </div>
  );
}
