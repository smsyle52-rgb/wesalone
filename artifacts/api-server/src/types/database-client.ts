export type QueryResult<T> = {
  rows: T[];
  rowCount: number | null;
};

export type PoolClient = {
  query: <T = any>(
    text: string,
    values?: unknown[],
  ) => Promise<QueryResult<T>>;
  release: () => void;
};
