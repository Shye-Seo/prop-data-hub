import { useEffect } from 'react';
import { NAV_ROUTES, ROUTE_TITLES, useRoute, type RouteKey } from './lib/router';
import { tracker } from './lib/tracker';
import { SAMPLE_END_MONTH } from '@prop/shared';
import Overview from './pages/Overview';
import Explore from './pages/Explore';
import Compare from './pages/Compare';
import RegionRisk from './pages/RegionRisk';
import Radar from './pages/Radar';
import JeonseSafety from './pages/JeonseSafety';
import CashPlan from './pages/CashPlan';
import Drawdown from './pages/Drawdown';
import RateLab from './pages/RateLab';
import Pipeline from './pages/Pipeline';
import Events from './pages/Events';
import ApiDocs from './pages/ApiDocs';
import Dictionary from './pages/Dictionary';

/**
 * 내비게이션은 한 단계로 편다. 화면 이름만 늘어놓고, 성격이 다른 두 묶음(시장 / 계산 도구)만
 * 작은 제목으로 나눈다. 하위 메뉴·2단 트리는 두지 않는다.
 */
const NAV_GROUPS: Array<{ label: string; keys: RouteKey[] }> = [
  { label: '시장', keys: ['overview', 'explore', 'compare', 'risk'] },
  { label: '도구', keys: ['radar', 'jeonse', 'cash', 'drawdown', 'rate'] },
];

const ROUTE_BY_KEY = new Map(NAV_ROUTES.map((item) => [item.key, item]));

export default function App() {
  const [route, navigate] = useRoute();

  useEffect(() => {
    tracker.track('page_view', {
      route: `/${route}`,
      isInitialLoad: tracker.getEvents().filter((event) => event.name === 'page_view').length === 0,
      deviceType: window.innerWidth < 640 ? 'mobile' : window.innerWidth < 1024 ? 'tablet' : 'desktop',
      referrer: document.referrer ? new URL(document.referrer).host : undefined,
    });
  }, [route]);

  const meta = ROUTE_TITLES[route];

  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden w-[226px] shrink-0 border-r border-line bg-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
        <div className="flex h-14 items-center border-b border-line px-4">
          <BrandMark />
        </div>

        <nav className="flex-1 overflow-y-auto px-2.5 py-3.5" aria-label="주요 화면">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-4 last:mb-0">
              <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-300">
                {group.label}
              </p>
              <ul className="space-y-px">
                {group.keys.map((key) => {
                  const item = ROUTE_BY_KEY.get(key);
                  if (!item) return null;
                  const active = route === key;
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() => navigate(key)}
                        aria-current={active ? 'page' : undefined}
                        title={item.description}
                        className={`group flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px] transition-colors ${
                          active
                            ? 'bg-canvas font-medium text-ink-900'
                            : 'text-ink-600 hover:bg-slate-50 hover:text-ink-900'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`h-1 w-1 shrink-0 rounded-full ${active ? 'bg-accent' : 'bg-transparent'}`}
                        />
                        <span className="truncate">{item.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-line px-4 py-3">
          <div className="flex items-baseline justify-between gap-2 text-[10.5px] text-ink-400">
            <span>데이터 기준월</span>
            <span className="num font-medium text-ink-700">{SAMPLE_END_MONTH}</span>
          </div>
          <p className="mt-1 text-[10.5px] leading-relaxed text-ink-300">실거래 신고 지연 1~2개월 반영</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-line bg-white/85 backdrop-blur-md">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            <div className="lg:hidden">
              <BrandMark compact />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[14px] font-semibold text-ink-900">{meta.title}</h1>
              <p className="hidden truncate text-[11.5px] text-ink-400 md:block">{meta.description}</p>
            </div>
            <div className="hidden shrink-0 items-center gap-2.5 sm:flex">
              <span className="num text-[11px] text-ink-400">기준월 {SAMPLE_END_MONTH}</span>
              <span aria-hidden="true" className="h-3 w-px bg-line" />
              <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-400">
                <span aria-hidden="true" className="dot bg-emerald-500" />
                최근 갱신 완료
              </span>
            </div>
          </div>

          <nav className="flex gap-0.5 overflow-x-auto border-t border-line px-2 lg:hidden" aria-label="화면 이동">
            {NAV_ROUTES.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => navigate(item.key)}
                aria-current={route === item.key ? 'page' : undefined}
                className={`tab ${route === item.key ? 'tab-active' : ''}`}
              >
                {item.short}
              </button>
            ))}
          </nav>
        </header>

        <main className="mx-auto w-full max-w-[1180px] flex-1 px-4 py-5 sm:px-6 sm:py-6">
          {route === 'overview' && <Overview navigate={navigate} />}
          {route === 'explore' && <Explore />}
          {route === 'compare' && <Compare />}
          {route === 'risk' && <RegionRisk />}
          {route === 'radar' && <Radar />}
          {route === 'jeonse' && <JeonseSafety />}
          {route === 'cash' && <CashPlan />}
          {route === 'drawdown' && <Drawdown />}
          {route === 'rate' && <RateLab />}
          {route === 'pipeline' && <Pipeline />}
          {route === 'events' && <Events />}
          {route === 'api' && <ApiDocs />}
          {route === 'dictionary' && <Dictionary />}

          <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3.5 text-[10.5px] text-ink-300">
            <span>prop-data-hub — 부산 6개 구 실거래·전세가율 분석</span>
            <a
              className="text-ink-400 underline decoration-line decoration-1 underline-offset-4 transition-colors hover:text-ink-700"
              href="https://github.com/Shye-Seo/prop-data-hub"
              target="_blank"
              rel="noreferrer noopener"
            >
              github.com/Shye-Seo/prop-data-hub
            </a>
          </footer>
        </main>
      </div>
    </div>
  );
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] bg-ink-900 text-[10px] font-semibold text-white"
        aria-label="prop-data-hub"
      >
        집
      </span>
      {!compact && (
        <span className="min-w-0">
          <span className="block truncate text-[12.5px] font-semibold tracking-[-0.01em] text-ink-900">prop-data-hub</span>
          <span className="block text-[10px] text-ink-400">부동산 데이터 해독 콘솔</span>
        </span>
      )}
    </div>
  );
}
