export type PoolClient = {
  query: (text: string, values?: unknown[]) => Promise<any>;
  release: () => void;
};
