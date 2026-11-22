import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PRIORITY_ZONE_LABEL,
  assessJeonseSafety,
  jeonseSafetyVerdictLabel,
  riskLevelLabel,
  type JeonseSafetyVerdict,
  type PriorityZone,
} from '@prop/shared';
import { Card, DataNote, Field } from '../components/ui';
import { formatAreaWithPyeong, formatKrwKorean, formatMonth } from '../lib/format';
import {
  COMPLEX_OPTIONS,
  areaOptionsForComplex,
  complexOption,
  defaultAreaOption,
  saleReference,
} from '../lib/tools';
import { tracker } from '../lib/tracker';

const DEFAULT_COMPLEX_ID = COMPLEX_OPTIONS[0]?.complexId ?? '';
const DEFAULT_AREA = defaultAreaOption(DEFAULT_COMPLEX_ID);
const DEFAULT_REFERENCE = DEFAULT_AREA ? saleReference(DEFAULT_COMPLEX_ID, DEFAULT_AREA.band) : null;
const DEFAULT_DEPOSIT_MANWON = DEFAULT_REFERENCE
  ? String(Math.min(49_000, Math.max(1_000, Math.round((DEFAULT_REFERENCE.medianPriceKrw * 0.6) / 1_000_000) * 100)))
  : '40000';

const ZONE_OPTIONS: Array<{ key: PriorityZone; label: string }> = [
  { key: 'metro', label: '부산광역시(광역시)' },
  { key: 'seoul', label: '서울특별시' },
  { key: 'overconcentration', label: '수도권 과밀억제권역·세종·용인·화성·김포' },
  { key: 'other', label: '그 밖의 지역' },
];

const VERDICT_STYLE: Record<JeonseSafetyVerdict, { badge: string; dot: string; text: string }> = {
  safe: { badge: 'border-emerald-200 bg-emerald-50 text-emerald-800', dot: 'bg-emerald-500', text: 'text-emerald-800' },
  caution: { badge: 'border-amber-200 bg-amber-50 text-amber-800', dot: 'bg-amber-500', text: 'text-amber-800' },
  risk: { badge: 'border-orange-200 bg-orange-50 text-orange-800', dot: 'bg-orange-500', text: 'text-orange-800' },
  danger: { badge: 'border-rose-200 bg-rose-50 text-rose-800', dot: 'bg-rose-500', text: 'text-rose-800' },
  unknown: { badge: 'border-line bg-slate-50 text-ink-600', dot: 'bg-slate-400', text: 'text-ink-700' },
};

export default function JeonseSafety() {
  const [complexId, setComplexId] = useState(DEFAULT_COMPLEX_ID);
  const [band, setBand] = useState(DEFAULT_AREA?.band ?? '60to85');
  const [depositManwon, setDepositManwon] = useState(DEFAULT_DEPOSIT_MANWON);
  const [seniorManwon, setSeniorManwon] = useState('0');
  const [zone, setZone] = useState<PriorityZone>('metro');
  const [customPrice, setCustomPrice] = useState(false);
  const [customPriceManwon, setCustomPriceManwon] = useState('');
  const initial = useRef(true);

  const complex = complexOption(complexId);
  const areaOptions = useMemo(() => areaOptionsForComplex(complexId), [complexId]);
  const area = areaOptions.find((row) => row.band === band) ?? areaOptions[0];
  const reference = area ? saleReference(complexId, area.band) : null;
  const marketPriceKrw = customPrice
    ? Number(customPriceManwon.replace(/[^0-9]/g, '')) * 10_000
    : reference?.medianPriceKrw ?? 0;
  const depositKrw = Number(depositManwon.replace(/[^0-9]/g, '')) * 10_000;
  const seniorKrw = Number(seniorManwon.replace(/[^0-9]/g, '')) * 10_000;

  const result = useMemo(
    () =>
      assessJeonseSafety({
        depositKrw,
        seniorMortgageKrw: seniorKrw,
        marketPriceKrw,
        priorityZone: zone,
        hugRegion: zone === 'seoul' || zone === 'overconcentration' ? 'capital' : 'non_capital',
      }),
    [depositKrw, seniorKrw, marketPriceKrw, zone],
  );

  const changeComplex = (nextId: string) => {
    setComplexId(nextId);
    const nextArea = defaultAreaOption(nextId);
    if (nextArea) {
      setBand(nextArea.band);
      const nextReference = saleReference(nextId, nextArea.band);
      if (nextReference && !customPrice) {
        setDepositManwon(
          String(Math.min(49_000, Math.max(1_000, Math.round((nextReference.medianPriceKrw * 0.6) / 1_000_000) * 100))),
        );
      }
    }
  };

  const applyRatio = (ratioPct: number) => {
    if (marketPriceKrw <= 0) return;
    setDepositManwon(String(Math.max(1_000, Math.round((marketPriceKrw * ratioPct) / 100 / 1_000_000) * 100)));
  };

  useEffect(() => {
    if (initial.current) {
      initial.current = false;
      return;
    }
    if (depositKrw <= 0 || marketPriceKrw <= 0 || !complex || !area) return;
    const timer = window.setTimeout(() => {
      tracker.track('jeonse_safety_check', {
        complexId,
        aptName: complex.name,
        areaM2: area.areaM2,
        depositKrw,
        seniorMortgageKrw: seniorKrw,
        jeonseRatioPct: result.jeonseRatioPct,
        verdict: result.verdict,
        hugEligible: result.hug.eligible,
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [complexId, band, depositKrw, seniorKrw, marketPriceKrw, zone, result.jeonseRatioPct, result.verdict, result.hug.eligible]);

  const style = VERDICT_STYLE[result.verdict];

  return (
    <div className="space-y-4">
      <div className="grid items-start gap-4 xl:grid-cols-[360px_1fr]">
        <Card title="진단 조건" subtitle="최근 6개월 중위 매매가를 시세 기준으로 씁니다.">
          <div className="space-y-3.5">
            <div className="space-y-2.5 border-b border-line-soft pb-3.5">
              <p className="label mb-0">대상 주택</p>
              <label className="block">
                <span className="mb-1.5 block text-[11.5px] font-medium text-ink-600">단지</span>
              <select
                className="select"
                value={complexId}
                onChange={(event) => changeComplex(event.target.value)}
                aria-label="진단할 단지"
                data-testid="jeonse-complex"
              >
                {COMPLEX_OPTIONS.map((option) => (
                  <option key={option.complexId} value={option.complexId}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 flex items-center justify-between text-[11.5px] font-medium text-ink-600">
                전용면적 구간
                {area && <span className="num text-[10.5px] font-normal text-ink-400">{formatAreaWithPyeong(area.areaM2)}</span>}
              </span>
              <select
                className="select"
                value={band}
                onChange={(event) => setBand(event.target.value as typeof band)}
                aria-label="전용면적 구간"
                data-testid="jeonse-band"
              >
                {areaOptions.map((option) => (
                  <option key={option.band} value={option.band}>
                    {option.label} · {formatAreaWithPyeong(option.areaM2)} · {option.sampleCount}건
                  </option>
                ))}
              </select>
            </label>

            </div>

            <div className="rounded-md border border-line bg-canvas/60 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="label">시세 기준(최근 6개월 중위)</p>
                <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-ink-400">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-accent"
                    checked={customPrice}
                    onChange={(event) => {
                      setCustomPrice(event.target.checked);
                      if (event.target.checked && !customPriceManwon) {
                        setCustomPriceManwon(String(Math.round((reference?.medianPriceKrw ?? 0) / 10_000)));
                      }
                    }}
                    data-testid="jeonse-custom-price"
                  />
                  직접 입력
                </label>
              </div>
              {customPrice ? (
                <div className="mt-1.5">
                  <input
                    type="number"
                    className="select num"
                    min={0}
                    step={100}
                    value={customPriceManwon}
                    onChange={(event) => setCustomPriceManwon(event.target.value)}
                    aria-label="시세 직접 입력(만원)"
                  />
                  <p className="num mt-1 text-[11px] text-ink-400">{formatKrwKorean(marketPriceKrw)}</p>
                </div>
              ) : (
                <p className="num mt-1 text-[13px] font-semibold text-ink-900">
                  {reference ? formatKrwKorean(reference.medianPriceKrw) : '표본 없음'}
                  {reference && (
                    <span className="ml-1 text-[10px] font-normal text-ink-400">
                      {reference.sampleCount}건 · {formatMonth(reference.latestMonth)}
                    </span>
                  )}
                </p>
              )}
            </div>

            <div className="space-y-2.5 border-t border-line-soft pt-3.5">
              <p className="label mb-0">보증금</p>
              <Field label="희망 전세 보증금" hint={formatKrwKorean(depositKrw)}>
              <input
                type="number"
                className="select num"
                min={0}
                step={100}
                value={depositManwon}
                onChange={(event) => setDepositManwon(event.target.value)}
                aria-label="희망 전세 보증금(만원)"
                data-testid="jeonse-deposit"
              />
            </Field>
            <div className="flex flex-wrap gap-1">
              {[60, 70, 80].map((ratio) => (
                <button key={ratio} type="button" className="chip" onClick={() => applyRatio(ratio)}>
                  시세의 {ratio}%
                </button>
              ))}
            </div>
            </div>

            <div className="space-y-2.5 border-t border-line-soft pt-3.5">
              <p className="label mb-0">선순위·지역</p>
              <Field label="선순위 근저당 채권최고액" hint={formatKrwKorean(seniorKrw)}>
              <input
                type="number"
                className="select num"
                min={0}
                step={100}
                value={seniorManwon}
                onChange={(event) => setSeniorManwon(event.target.value)}
                aria-label="선순위 근저당(만원)"
                data-testid="jeonse-senior"
              />
            </Field>
            <p className="-mt-1 text-[10px] leading-relaxed text-ink-300">
              등기부등본 을구의 근저당권 채권최고액을 넣습니다. 없으면 0.
            </p>

            <label className="block">
              <span className="mb-1.5 block text-[11.5px] font-medium text-ink-600">최우선변제 권역</span>
              <select
                className="select"
                value={zone}
                onChange={(event) => setZone(event.target.value as PriorityZone)}
                aria-label="최우선변제 권역"
              >
                {ZONE_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <section className="card" data-testid="jeonse-verdict">
            <div className="card-pad">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="label">진단 결과</p>
                  <div className="mt-1 flex items-center gap-2">
                    <p className={`text-[24px] font-semibold leading-none tracking-[-0.03em] ${style.text}`}>{jeonseSafetyVerdictLabel(result.verdict)}</p>
                    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10.5px] font-medium ${style.badge}`}>
                      <span className={`dot ${style.dot}`} aria-hidden="true" />
                      전세가율 {result.jeonseRatioPct.toFixed(1)}% · {riskLevelLabel(result.ratioLevel)}
                    </span>
                  </div>
                  <p className="mt-1.5 max-w-2xl text-[11.5px] leading-relaxed text-ink-500">{result.headline}</p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-4 lg:grid-cols-4">
                <Tile label="전세가율" value={`${result.jeonseRatioPct.toFixed(1)}%`} hint="(보증금 + 선순위) ÷ 시세" />
                <Tile label="보증금 + 선순위" value={formatKrwKorean(result.totalClaimKrw)} hint={`시세 ${formatKrwKorean(marketPriceKrw)}`} />
                <Tile
                  label="HUG 보증 가능 금액"
                  value={result.hug.eligible ? formatKrwKorean(result.hug.coveredDepositKrw) : '가입 불가'}
                  hint={result.hug.eligible ? '보증금 전액 보증 가능' : result.hug.reasons[0] ?? '요건 미달'}
                />
                <Tile
                  label="시세 -20% 회수액"
                  value={formatKrwKorean(result.stress.find((row) => row.dropPct === -20)?.recoverableKrw ?? 0)}
                  hint={`손실 ${formatKrwKorean(result.stress.find((row) => row.dropPct === -20)?.lossKrw ?? 0)}`}
                />
              </div>
            </div>
          </section>

          <div className="grid items-start gap-4 lg:grid-cols-2">
            <Card title="최우선변제금" subtitle="경매 시 다른 담보권보다 먼저 돌려받는 금액">
              <dl className="space-y-2 text-[12px]">
                <Row label="권역" value={PRIORITY_ZONE_LABEL[result.priority.zone]} />
                <Row
                  label="소액임차인 기준"
                  value={`보증금 ${formatKrwKorean(result.priority.depositThresholdKrw)} 이하`}
                  tone={result.priority.eligible ? 'good' : 'muted'}
                />
                <Row
                  label="최우선변제 인정액"
                  value={result.priority.eligible ? formatKrwKorean(result.priority.recognizedKrw) : '대상 아님'}
                  tone={result.priority.eligible ? 'good' : 'muted'}
                />
                <Row label="최우선변제 대상이 아닌 보증금" value={formatKrwKorean(result.priority.uncoveredDepositKrw)} />
              </dl>
              <p className="mt-2 border-t border-line-soft pt-2 text-[10px] leading-relaxed text-ink-400">
                {result.priority.eligible
                  ? `법정 한도 ${formatKrwKorean(result.priority.statutoryAmountKrw)}에서 시세의 1/2 한도를 적용했습니다. 전입신고·확정일자와 대항요건을 갖춰야 효력이 있습니다.`
                  : `보증금이 ${PRIORITY_ZONE_LABEL[result.priority.zone]} 소액임차인 기준을 넘어 최우선변제 대상이 아닙니다.`}
              </p>
            </Card>

            <Card title="HUG 전세보증금반환보증" subtitle="재무 요건 사전 점검 · 실제 심사와 다를 수 있습니다">
              <ul className="space-y-2 text-[12px]">
                <CheckRow
                  label={`보증금 ${result.hug.depositLimitKrw === 700_000_000 ? '7억' : '5억'}원 이하`}
                  pass={result.hug.depositWithinLimit}
                  detail={formatKrwKorean(result.depositKrw)}
                />
                <CheckRow
                  label="보증금+선순위 90% 이하"
                  pass={marketPriceKrw > 0 && result.hug.shortfallKrw === 0 && result.hug.collateralCapKrw > 0}
                  detail={`한도 ${formatKrwKorean(result.hug.collateralCapKrw)}`}
                />
                <CheckRow
                  label="선순위 근저당 ≤ 주택가액 60%"
                  pass={marketPriceKrw > 0 && result.seniorMortgageKrw <= result.hug.seniorCapKrw}
                  detail={`한도 ${formatKrwKorean(result.hug.seniorCapKrw)}`}
                />
              </ul>
              <div className="mt-3 rounded-lg border border-slate-200 px-3 py-2">
                <p className="label">보증한도(주택가격 × 90% − 선순위)</p>
                <p className="num mt-0.5 text-sm font-semibold text-ink-800">{formatKrwKorean(result.hug.maxGuaranteeKrw)}</p>
                {!result.hug.eligible && (
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[10px] text-rose-600">
                    {result.hug.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                )}
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                HUG는 KB시세·공시가격(140%)을 주택가격으로 씁니다. 여기서는 최근 실거래 중위가로 계산했으므로 실제 가입 심사와 차이가 날 수 있습니다.
              </p>
            </Card>
          </div>

          <Card title="시세 하락 시나리오" subtitle="최우선변제 → 선순위 근저당 → 보증금 순으로 배당한다고 가정">
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <thead>
                  <tr className="table-head">
                    <th className="px-2 py-[7px] text-left">시세 하락</th>
                    <th className="px-2 py-[7px] text-right">가정 시세</th>
                    <th className="px-2 py-[7px] text-right">회수 가능 보증금</th>
                    <th className="px-2 py-[7px] text-right">손실</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {result.stress.map((row) => (
                    <tr key={row.dropPct}>
                      <td className="num px-2 py-[7px] text-[11.5px] font-semibold text-ink-700">{row.dropPct}%</td>
                      <td className="num px-2 py-[7px] text-right text-[11.5px] text-ink-500">{formatKrwKorean(row.assumedPriceKrw)}</td>
                      <td className="num px-2 py-[7px] text-right text-[11.5px] text-ink-700">{formatKrwKorean(row.recoverableKrw)}</td>
                      <td className={`num px-2 py-2 text-right text-xs font-semibold ${row.lossKrw > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                        {row.lossKrw > 0 ? formatKrwKorean(row.lossKrw) : '없음'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[10px] text-slate-400">경매비용·최저매각가·다른 채권자는 반영하지 않은 단순 배당 가정입니다.</p>
          </Card>

          <Card title="판정 근거" subtitle="계산에 쓴 숫자와 기준을 그대로 보여줍니다">
            <ul className="space-y-1.5">
              {result.signals.map((signal) => (
                <li key={signal.code} className="rounded-lg border border-slate-200 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
                  <span className="font-semibold text-slate-800">{signal.label}</span>
                  <span className="ml-1.5 text-[10px] text-slate-400">{riskLevelLabel(signal.level)}</span>
                  <span className="mt-0.5 block">{signal.detail}</span>
                </li>
              ))}
            </ul>
          </Card>

          <DataNote>
            최우선변제금은 주택임대차보호법 시행령 제10조·제11조(2023.2.21 시행) 기준입니다. 부산 등 광역시는 보증금 8,500만원 이하,
            최대 2,800만원이며, 담보물권 설정일의 시행령이 적용됩니다. HUG는 보증금 수도권 7억·그 외 5억원 이하, 보증금+선순위가
            주택가격의 90% 이하, 선순위가 주택가액(주택가격×90%)의 60% 이하일 때 가입을 심사합니다. 전입신고·확정일자, 계약기간 1년 이상, 권리침해 없음 등
            비재무 요건은 별도이며, 이 화면은 계약 전 참고용입니다.
          </DataNote>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <p className="label">{label}</p>
      <p className="num mt-1 text-[18px] font-semibold leading-none tracking-[-0.02em] text-ink-900">{value}</p>
      <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-ink-400">{hint}</p>
    </div>
  );
}

function Row({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'good' | 'muted' }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-400">{label}</dt>
      <dd className={`num max-w-[62%] text-right text-[12px] font-semibold leading-snug ${tone === 'good' ? 'text-emerald-700' : tone === 'muted' ? 'text-ink-300' : 'text-ink-800'}`}>
        {value}
      </dd>
    </div>
  );
}

function CheckRow({ label, pass, detail }: { label: string; pass: boolean; detail: string }) {
  return (
    <li className="flex items-start justify-between gap-2 border-b border-line-soft pb-1.5 last:border-0">
      <span className="text-[11.5px] text-ink-600">
        <span className={`mr-1.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-bold ${pass ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
          {pass ? '✓' : '✕'}
        </span>
        {label}
      </span>
      <span className="num shrink-0 text-right text-[10px] text-ink-400">{detail}</span>
    </li>
  );
}
