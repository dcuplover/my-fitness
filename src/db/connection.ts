import { connect } from "@lancedb/lancedb";
import type { LanceDbTable } from "@lancedb/lancedb";

// 单例连接缓存: dbPath -> db instance
const dbCache = new Map<string, Awaited<ReturnType<typeof connect>>>();

// 表缓存: "dbPath::tableName" -> table instance
const tableCache = new Map<string, LanceDbTable>();

/**
 * 获取 LanceDB 连接（单例，按 dbPath 缓存）
 */
export async function getDb(dbPath: string) {
    let db = dbCache.get(dbPath);
    if (!db) {
        db = await connect(dbPath);
        dbCache.set(dbPath, db);
    }
    return db;
}

/**
 * 获取指定表（带缓存）
 * 为原生 table 补充 filter 便捷方法: table.filter(where) => table.query().where(where)
 */
export async function getTable(dbPath: string, tableName: string): Promise<LanceDbTable> {
    const cacheKey = `${dbPath}::${tableName}`;
    let table = tableCache.get(cacheKey);
    if (!table) {
        const db = await getDb(dbPath);
        const raw = await db.openTable(tableName);
        // LanceDB 0.22+ 不再提供 table.filter()，用 query().where() 模拟
        if (typeof (raw as any).filter !== "function") {
            (raw as any).filter = (where: string) => (raw as any).query().where(where);
        }
        table = raw;
        tableCache.set(cacheKey, table);
    }
    return table;
}

/**
 * 清除表缓存（表结构变更后使用）
 */
export function invalidateTableCache(dbPath: string, tableName: string) {
    tableCache.delete(`${dbPath}::${tableName}`);
}

/**
 * 检查表是否存在
 */
export async function tableExists(dbPath: string, tableName: string): Promise<boolean> {
    const db = await getDb(dbPath);
    const names = await db.tableNames();
    return names.includes(tableName);
}
