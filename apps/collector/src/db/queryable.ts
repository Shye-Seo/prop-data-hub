/** pg Pool과 PGlite가 함께 만족하는 최소 쿼리 인터페이스(API의 Queryable과 동일 형태). */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
