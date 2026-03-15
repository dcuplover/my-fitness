declare module "@lancedb/lancedb" {
  export type LanceDbRow = Record<string, unknown>;

  export type LanceDbIndexConfig = {
    config?: {
      inner?: unknown;
    };
    replace?: boolean;
  };

  export type LanceDbTable = {
    search(
      query: string | number[] | Float32Array,
      queryType?: string,
      ftsColumns?: string[],
    ): {
      limit(limit: number): {
        toArray(): Promise<LanceDbRow[]>;
      };
    };
    add(data: LanceDbRow[]): Promise<unknown>;
    update(options: { where: string; values: Record<string, unknown> }): Promise<void>;
    delete(where: string): Promise<void>;
    createIndex(column: string, options?: LanceDbIndexConfig): Promise<void>;
    countRows(filter?: string): Promise<number>;
    filter(where: string): {
      limit(limit: number): {
        toArray(): Promise<LanceDbRow[]>;
      };
      toArray(): Promise<LanceDbRow[]>;
    };
    toArray(): Promise<LanceDbRow[]>;
  };

  export class Index {
    static fts(): Index;
  }

  export function connect(uri: string): Promise<{
    tableNames(): Promise<string[]>;
    openTable(name: string): Promise<LanceDbTable>;
    createTable(name: string, data: LanceDbRow[]): Promise<LanceDbTable>;
    dropTable(name: string): Promise<void>;
  }>;
}
