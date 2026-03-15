let counter = 0;

/**
 * 生成唯一 ID: 前缀-时间戳-计数器
 */
export function generateId(prefix: string = "fit"): string {
    counter++;
    const ts = Date.now().toString(36);
    const cnt = counter.toString(36).padStart(4, "0");
    const rand = Math.random().toString(36).slice(2, 6);
    return `${prefix}-${ts}-${cnt}-${rand}`;
}

/**
 * 获取当前 ISO 时间字符串
 */
export function nowISO(): string {
    return new Date().toISOString();
}

/**
 * 获取当前日期字符串 YYYY-MM-DD
 */
export function todayStr(): string {
    return new Date().toISOString().split("T")[0];
}
