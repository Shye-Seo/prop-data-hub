import { useEffect } from 'react';
import { NAV_ROUTES, ROUTE_TITLES, useRoute } from './lib/router';
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
    <div className="min-h-screen bg-slate-50 lg:flex">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-ink-700/40 bg-ink-900 px-4 py-6 text-slate-200 lg:sticky lg:top-0 lg:flex lg:h-screen lg:overflow-y-auto">
        <BrandMark />
        <nav className="mt-7 space-y-1" aria-label="주요 화면">
          {NAV_ROUTES.map((item) => (
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
          </div>

          <nav className="flex gap-1 overflow-x-auto border-t border-slate-100 px-3 py-2 lg:hidden" aria-label="화면 이동">
            {NAV_ROUTES.map((item) => (
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

          <footer className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4 text-[11px] text-slate-400">
            <span>prop-data-hub · 부산 6개 구 실거래·전세가율 분석 콘솔</span>
            <a
              className="underline decoration-dotted"
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
