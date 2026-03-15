import type { LanceDbRow } from "@lancedb/lancedb";

/**
 * 将行数组格式化为可读文本
 */
export function formatRows(rows: LanceDbRow[], columns?: string[]): string {
    if (rows.length === 0) return "无数据";

    return rows
        .filter((row) => row.id !== "__placeholder__")
        .map((row, i) => {
            const cols = columns || Object.keys(row);
            const fields = cols
                .map((key) => {
                    const val = row[key];
                    if (val === undefined || val === null || val === "") return undefined;
                    return `${key}: ${String(val)}`;
                })
                .filter(Boolean);
            return `${i + 1}. ${fields.join(" | ")}`;
        })
        .filter(Boolean)
        .join("\n");
}

/**
 * 构建工具返回值
 */
export function toolResult(text: string) {
    return { content: [{ type: "text" as const, text }] };
}

/**
 * 获取本周一的日期字符串 YYYY-MM-DD
 */
export function getWeekStartDate(dateStr?: string): string {
    const date = dateStr ? new Date(dateStr) : new Date();
    const day = date.getDay();
    const diff = day === 0 ? 6 : day - 1; // 周日=6, 周一=0, ...
    date.setDate(date.getDate() - diff);
    return date.toISOString().split("T")[0];
}

/**
 * 安全解析 JSON 字符串，失败返回默认值
 */
export function safeJsonParse<T>(str: string, fallback: T): T {
    try {
        return JSON.parse(str);
    } catch {
        return fallback;
    }
}
