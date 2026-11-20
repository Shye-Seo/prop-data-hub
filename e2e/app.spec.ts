import { expect, test, type Page } from '@playwright/test';

interface TrackedEvent {
  eventId: string;
  name: string;
  props: Record<string, unknown>;
  sessionId: string;
}

async function events(page: Page): Promise<TrackedEvent[]> {
  return page.evaluate(() => (window as unknown as { __propAnalytics?: { getEvents: () => TrackedEvent[] } }).__propAnalytics?.getEvents() ?? []);
}

async function waitForEvent(page: Page, name: string, predicate?: (event: TrackedEvent) => boolean) {
  await expect
    .poll(async () => {
      const list = await events(page);
      return list.filter((event) => event.name === name && (!predicate || predicate(event))).length;
    }, { timeout: 8_000 })
    .toBeGreaterThan(0);
}

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '시장 개요' })).toBeVisible();
}

async function navigateTo(page: Page, label: RegExp) {
  await page.locator('aside').getByRole('button', { name: label }).click();
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('개요 화면이 KPI·차트·수집 상태를 렌더링한다', async ({ page }) => {
  await expect(page.getByText('관측 거래').first()).toBeVisible();
  await expect(page.getByText('최근월 중위 매매가')).toBeVisible();
  await expect(page.getByRole('img', { name: /지역별 중위 매매가/ })).toBeVisible();
  await expect(page.getByText('최근 수집 실행')).toBeVisible();
  await expect(page.getByText('한국은행 ECOS', { exact: false }).first()).toBeVisible();

  // 차트에는 지역 3개의 선이 그려진다.
  const polylines = page.locator('svg[aria-label*="지역별 중위 매매가"] polyline');
  expect(await polylines.count()).toBeGreaterThanOrEqual(3);

  const list = await events(page);
  expect(list.some((event) => event.name === 'page_view' && event.props.route === '/overview')).toBeTruthy();
});

test('지역 필터를 바꾸면 화면과 region_filter_change 이벤트가 함께 바뀐다', async ({ page }) => {
  await page.getByRole('button', { name: '남구 대연동' }).click();
  await expect(page.getByText('대연동 중위 매매가 추이')).toBeVisible();
  await waitForEvent(page, 'region_filter_change', (event) => event.props.dong === '대연동');
  const filtered = (await events(page)).filter((event) => event.name === 'region_filter_change');
  expect(filtered.at(-1)?.props.lawdCd).toBe('26290');
  expect(Number(filtered.at(-1)?.props.resultCount)).toBeGreaterThan(0);
});

test('실거래 탐색에서 단지·면적 필터와 CSV 저장이 동작한다', async ({ page }) => {
  await navigateTo(page, /실거래 탐색/);
  await expect(page.getByRole('heading', { name: '실거래 탐색' })).toBeVisible();

  await page.getByLabel('단지 선택').selectOption({ label: '문현베스티움' });
  await page.getByRole('button', { name: '60~85㎡' }).click();
  await expect.poll(async () => page.locator('[data-testid="transaction-table"] tbody tr').count()).toBeGreaterThan(0);

  const rows = page.locator('[data-testid="transaction-table"] tbody tr');
  const count = await rows.count();
  for (let index = 0; index < Math.min(count, 5); index += 1) {
    await expect(rows.nth(index)).toContainText('문현베스티움');
  }

  await waitForEvent(page, 'region_filter_change', (event) => event.props.complexId === 'MOLIT-26290-001');

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-csv').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/prop-data-hub-transactions-\d{4}-\d{2}-\d{2}\.csv/);
  await waitForEvent(page, 'funnel_step_complete', (event) => event.props.step === 'report_export');
  await expect(page.getByRole('status')).toContainText('CSV로 저장');
});

test('단지 비교에서 3개까지 추가되고 평당가 차트가 갱신된다', async ({ page }) => {
  await navigateTo(page, /단지 비교/);
  await expect(page.getByRole('heading', { name: '단지 비교' })).toBeVisible();

  const chartPolylines = page.locator('svg[aria-label*="평당가 추이 비교"] polyline');
  expect(await chartPolylines.count()).toBe(2);

  await page.getByLabel('문현경동리인 비교에 추가').check();
  await expect.poll(async () => chartPolylines.count()).toBe(3);
  await waitForEvent(page, 'complex_compare_add', (event) => event.props.compareCount === 3);

  await page.getByLabel('오션파라곤 비교에 추가').click();
  await expect(page.getByText('비교는 최대 3개 단지까지 가능합니다', { exact: false })).toBeVisible();

  const summary = page.locator('table').filter({ hasText: '최근월 평당가' });
  await expect(summary).toContainText('문현베스티움');
  await expect(summary).toContainText('문현경동리인');
});

test('금리 시뮬레이터가 입력에 따라 상환액을 다시 계산하고 이벤트를 남긴다', async ({ page }) => {
  await navigateTo(page, /금리 민감도/);
  await expect(page.getByRole('heading', { name: '금리 민감도' })).toBeVisible();

  const monthlyTile = page.getByText('월 상환액', { exact: true }).first().locator('..');
  const monthlyBefore = await monthlyTile.innerText();

  await page.getByLabel('대출 금리').fill('6');
  await page.getByLabel('상환 기간').selectOption('30');
  await expect.poll(async () => page.getByLabel('대출 금리').inputValue()).toBe('6');

  await waitForEvent(page, 'rate_scenario_adjust', (event) => Number(event.props.annualRatePct) === 6);
  const monthlyAfter = await monthlyTile.innerText();
  expect(monthlyAfter).not.toBe(monthlyBefore);
  await expect(page.getByText('금리 구간별 월 상환액')).toBeVisible();
  await expect(page.locator('svg[aria-label*="금리 구간별 월 상환액"] polyline')).toHaveCount(1);
});

test('수집 파이프라인 콘솔에서 출처 확인·실행·DLQ 재시도가 동작한다', async ({ page }) => {
  await navigateTo(page, /수집 파이프라인/);
  await expect(page.getByRole('heading', { name: '수집 파이프라인' })).toBeVisible();

  const runRows = page.locator('[data-testid="run-table"] tbody tr');
  expect(await runRows.count()).toBeGreaterThanOrEqual(5);

  await page.getByRole('button', { name: '출처 확인 →' }).first().click();
  await waitForEvent(page, 'pipeline_source_inspect', (event) => event.props.panel === 'sources');

  await runRows.first().click();
  await expect(page.getByText('실행 상세', { exact: false }).first()).toBeVisible();
  await waitForEvent(page, 'pipeline_source_inspect', (event) => event.props.panel === 'run_detail');
  await expect(page.getByTestId('task-table')).toContainText('성공');
  await expect(page.getByTestId('task-table')).toContainText('실패');

  const runsBefore = await runRows.count();
  await page.getByTestId('simulate-run').click();
  await expect.poll(async () => page.locator('[data-testid="run-table"] tbody tr').count()).toBe(runsBefore + 1);
  await waitForEvent(page, 'pipeline_source_inspect', (event) => event.props.panel === 'runs');

  await page.getByRole('button', { name: '재시도' }).first().click();
  await expect(page.getByText('해결', { exact: false }).first()).toBeVisible();
  await waitForEvent(page, 'pipeline_source_inspect', (event) => event.props.panel === 'dlq');
});

test('행동 이벤트 화면에서 퍼널·스트림·스키마가 실시간으로 갱신된다', async ({ page }) => {
  await navigateTo(page, /행동 이벤트/);
  await expect(page.getByRole('heading', { name: '행동 이벤트' })).toBeVisible();

  const funnel = page.getByTestId('funnel').locator('li');
  await expect(funnel).toHaveCount(5);
  await expect(page.getByTestId('funnel')).toContainText('대시보드 진입');
  await expect(page.getByTestId('funnel')).toContainText('분석 리포트 저장');

  const before = Number(await page.getByTestId('total-events').innerText().then((text) => text.replace(/[^0-9]/g, '')));
  expect(before).toBeGreaterThan(0);

  await page.getByRole('button', { name: '+ 단지 비교 추가' }).click();
  await expect
    .poll(async () => Number((await page.getByTestId('total-events').innerText()).replace(/[^0-9]/g, '')))
    .toBeGreaterThan(before);

  await expect(page.getByTestId('event-stream')).toContainText('단지 비교 추가');
  await expect(page.getByText('최근 수집 예시')).toBeVisible();
  await page.getByLabel('스키마 이벤트 선택').selectOption('rate_scenario_adjust');
  await expect(page.getByText('annualRatePct, termMonths, repayment', { exact: false })).toBeVisible();
});

test('새로고침 후에도 로컬 이벤트 스트림이 유지된다', async ({ page }) => {
  await navigateTo(page, /행동 이벤트/);
  await page.getByRole('button', { name: '+ 지역 조건 변경' }).click();
  const before = Number((await page.getByTestId('total-events').innerText()).replace(/[^0-9]/g, ''));
  expect(before).toBeGreaterThan(0);

  await page.reload();
  await expect(page.getByRole('heading', { name: '행동 이벤트' })).toBeVisible();
  await expect
    .poll(async () => Number((await page.getByTestId('total-events').innerText()).replace(/[^0-9]/g, '')))
    .toBeGreaterThanOrEqual(before);
});

test('모바일 뷰포트에서도 탐색과 차트가 깨지지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole('heading', { name: '시장 개요' })).toBeVisible();
  await page.getByRole('button', { name: '개요', exact: true }).count();
  await page.getByRole('navigation', { name: '화면 이동' }).getByRole('button', { name: '금리' }).click();
  await expect(page.getByRole('heading', { name: '금리 민감도' })).toBeVisible();
  const chart = page.locator('svg[aria-label*="금리 구간별 월 상환액"]');
  await expect(chart).toBeVisible();
  const box = await chart.boundingBox();
  expect(box?.width ?? 0).toBeLessThanOrEqual(390);
});

test('매물 클릭·관심 등록이 인스펙터에 실시간으로 찍힌다', async ({ page }) => {
  await expect(page.getByTestId('inspector')).toBeVisible();
  await expect(page.getByTestId('inspector')).toContainText('이벤트 파이프라인');
  await expect(page.getByTestId('stage-capture')).toContainText('건');

  await navigateTo(page, /실거래 탐색/);
  const firstRow = page.locator('[data-testid="transaction-table"] tbody tr').first();
  await firstRow.click();
  await expect(page.getByTestId('deal-detail')).toBeVisible();
  await expect(page.getByTestId('deal-detail')).toContainText('계약');

  await waitForEvent(page, 'listing_click', (event) => event.props.source === 'explore_table');
  await expect(page.getByTestId('inspector-json')).toContainText('listing_click');
  await expect(page.getByTestId('inspector-json')).toContainText('schema_version');

  await page.getByTestId('save-listing').click();
  await waitForEvent(page, 'listing_save', (event) => event.props.action === 'add');
  await expect(page.getByTestId('inspector-json')).toContainText('listing_save');
  await expect(page.getByRole('status')).toContainText('관심에 담았습니다');

  // 퍼널 첫 단계가 채워지고, 화면 이동도 page_view로 기록된다.
  await expect(page.getByTestId('inspector').locator('ol').last()).toContainText('대시보드 진입');
});

test('구별 리스크 화면이 전세가율·이상 거래 배지와 상세 신호를 보여준다', async ({ page }) => {
  await navigateTo(page, /구별 리스크/);
  await expect(page.getByRole('heading', { name: '구별 리스크' })).toBeVisible();
  await expect(page.getByText('중위 전세가율', { exact: true })).toBeVisible();
  await expect(page.getByText('고위험 단지', { exact: true })).toBeVisible();

  for (const label of ['구별 중위 평당가', '구별 중위 전세가율', '구별 12개월 거래량']) {
    const chart = page.locator(`svg[aria-label*="${label}"]`);
    await expect(chart).toBeVisible();
    expect(await chart.locator('rect').count()).toBeGreaterThanOrEqual(3);
  }
  await expect(page.locator('svg[aria-label*="전세가율 추이"] polyline').first()).toBeVisible();

  const rows = page.locator('[data-testid="risk-table"] tbody tr');
  await expect(rows).toHaveCount(33);
  await expect(rows.first()).toContainText('%');

  await page.getByTestId('risk-row-MOLIT-26290-005').click();
  await expect(page.getByText('문현현대 상세')).toBeVisible();
  await expect(page.getByText('전세가율', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('매매 중위', { exact: false }).first()).toBeVisible();
  await waitForEvent(page, 'listing_click', (event) => event.props.source === 'risk');

  // 수영구만 보기
  await page.getByRole('button', { name: '수영구', exact: true }).click();
  await expect(rows).toHaveCount(4);
  await expect(page.getByText('삼익비치타운').first()).toBeVisible();
});

test('급매 레이더가 350세대 필터·세대수 토글·알림 규칙 미리보기를 제공한다', async ({ page }) => {
  await navigateTo(page, /급매 레이더/);
  await expect(page.getByRole('heading', { name: '급매 레이더' })).toBeVisible();
  await expect(page.getByText('레이더 조건')).toBeVisible();

  const rows = page.locator('[data-testid="radar-table"] tbody tr');
  await expect.poll(async () => rows.count()).toBeGreaterThan(0);
  const largeOnly = await rows.count();
  await expect(rows.first()).toContainText('세대');

  // 세대수 토글을 끄면 350세대 미만 단지의 급매까지 늘어난다.
  await page.getByTestId('radar-large-only').uncheck();
  await expect.poll(async () => rows.count()).toBeGreaterThan(largeOnly);
  await expect(page.getByTestId('radar-table')).toContainText('가야KTe편한세상');
  await page.getByTestId('radar-large-only').check();
  await expect.poll(async () => page.getByTestId('radar-table').innerText()).not.toContain('가야KTe편한세상');

  // 행을 누르면 근거가 열리고 listing_click(source=radar)이 기록된다.
  await rows.first().click();
  await expect(page.getByTestId('radar-detail')).toContainText('기준 시세(중위)');
  await waitForEvent(page, 'listing_click', (event) => event.props.source === 'radar');

  // 구 조건을 바꾸면 800ms 뒤 radar_filter_change가 남는다.
  await page.getByTestId('radar-district-26230').click();
  await waitForEvent(
    page,
    'radar_filter_change',
    (event) => Array.isArray(event.props.lawdCds) && (event.props.lawdCds as string[]).includes('26230'),
  );

  // 알림 규칙 저장 → 카카오 알림톡·웹훅 payload 미리보기 + alert_rule_create 이벤트
  await page.getByTestId('radar-rule-name').fill('부산진구 급매');
  await page.getByTestId('radar-save-rule').click();
  await expect(page.getByTestId('radar-preview')).toContainText('PROP_RADAR_DEAL_01');
  await expect(page.getByTestId('radar-preview')).toContainText('부산진구 급매');
  await waitForEvent(page, 'alert_rule_create', (event) => Number(event.props.matchedCount) >= 0);
  await expect(page.getByTestId('radar-rule-list')).toContainText('부산진구 급매');
});

test('API 문서에서 OpenAPI 오퍼레이션과 스키마를 열람하고 Mock 응답을 실행한다', async ({ page }) => {
  await navigateTo(page, /API 문서/);
  await expect(page.getByRole('heading', { name: 'API 문서' })).toBeVisible();
  await expect(page.getByText('OpenAPI 1.2.0', { exact: false })).toBeVisible();

  await page.getByRole('button', { name: /\/api\/v1\/rents/ }).click();
  await expect(page.getByRole('paragraph').filter({ hasText: '전월세 실거래 조회' })).toBeVisible();
  await page.getByTestId('run-mock').click();
  await expect(page.getByTestId('mock-response')).toContainText('"mock": true');
  await expect(page.getByTestId('mock-response')).toContainText('depositKrw');
  await waitForEvent(page, 'api_doc_mock_run', (event) => event.props.endpoint === '/api/v1/rents');

  await page.getByRole('tab', { name: '스키마·ERD' }).click();
  await expect(page.getByTestId('schema-table')).toContainText('deposit_krw');
  await expect(page.getByTestId('schema-table')).toContainText('contract_type');
  await expect(page.getByText('apt_rent_transactions.complex_id', { exact: false }).first()).toBeVisible();
});
