export type QueryResult<T> = {
  rows: T[];
  rowCount: number | null;
};

export type PoolClient = {
  query: <T = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<QueryResult<T>>;
  release: () => void;
};
