import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SCHEMA_RELATIONS, SCHEMA_TABLES } from './schema-summary';

const initSql = readFileSync(fileURLToPath(new URL('../../../infra/postgres/init.sql', import.meta.url)), 'utf8');

/** init.sql에서 테이블·뷰 정의 블록을 뽑아 컬럼 검사에 쓴다. */
function definitionBlock(name: string): string {
  const patterns = [
    new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\(([\\s\\S]*?)\\n\\);`),
    new RegExp(`CREATE OR REPLACE VIEW ${name} AS([\\s\\S]*?);`),
    new RegExp(`CREATE MATERIALIZED VIEW IF NOT EXISTS ${name} AS([\\s\\S]*?)WITH NO DATA;`),
  ];
  for (const pattern of patterns) {
    const match = initSql.match(pattern);
    if (match?.[1]) return match[1];
  }
  return '';
}

describe('스키마 요약과 init.sql 일치', () => {
  it('요약한 테이블·뷰가 모두 DDL에 있다', () => {
    for (const table of SCHEMA_TABLES) {
      const block = definitionBlock(table.name);
      expect(block, `${table.name} 정의를 init.sql에서 찾지 못했습니다`).not.toBe('');
    }
  });

  it('요약한 컬럼 이름이 해당 정의에 있다', () => {
    for (const table of SCHEMA_TABLES) {
      const block = definitionBlock(table.name);
      for (const column of table.columns) {
        if (column.name.includes(' ')) continue;
        expect(block, `${table.name}.${column.name}`).toMatch(new RegExp(`\\b${column.name}\\b`));
      }
    }
  });

  it('DDL에 있는 일반 테이블과 파티션 자식 테이블을 빠짐없이 설명한다', () => {
    const ddlTables = [...initSql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)]
      .map((match) => match[1]!)
      .filter((name) => !name.endsWith('_default') && !/^user_behavior_events_\d{6}$/.test(name));
    const summarized = SCHEMA_TABLES.filter((table) => table.kind === 'table').map((table) => table.name);
    expect(new Set(ddlTables)).toEqual(new Set(summarized));
  });

  it('관계의 양 끝 테이블이 요약에 있고, 자기 자신을 참조하지 않는다', () => {
    const names = new Set(SCHEMA_TABLES.map((table) => table.name));
    for (const relation of SCHEMA_RELATIONS) {
      expect(names.has(relation.from)).toBe(true);
      expect(names.has(relation.to)).toBe(true);
      expect(relation.from).not.toBe(relation.to);
      expect(relation.fromColumn).not.toBe('');
    }
  });

  it('파티션·인덱스 설명이 실제 DDL 인덱스 이름과 맞는다', () => {
    const ddlIndexes = new Set([...initSql.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+)/g)].map((match) => match[1]!));
    for (const table of SCHEMA_TABLES) {
      for (const index of table.indexes) {
        expect(ddlIndexes.has(index), `${table.name} 인덱스 ${index}`).toBe(true);
      }
    }
    expect(initSql).toMatch(/PARTITION BY RANGE \(occurred_date\)/);
  });
});
