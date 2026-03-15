import { getTable } from "../db/connection";
import { TABLE_NAMES } from "../db/schemas";
import { todayStr } from "../utils/id-gen";
import { safeJsonParse } from "../utils/format";
import type { LanceDbRow } from "@lancedb/lancedb";

type PluginConfig = {
    lanceDbPath?: string;
    defaultMemberId?: string;
    calorieWarningThreshold?: number;
    lowStockThreshold?: number;
    expiryWarningDays?: number;
};

const PLUGIN_ID = "my-fitness";

function getPluginConfig(api: any): PluginConfig {
    return api.config?.plugins?.entries?.[PLUGIN_ID]?.config ?? {};
}

/**
 * 注册 before_prompt_build 钩子，在每次用户对话时注入轻量健康上下文
 */
export function registerContextInjector(api: any) {
    api.on("before_prompt_build", async (event: { prompt: string }, ctx: { trigger?: string }) => {
        if (ctx?.trigger && ctx.trigger !== "user") return;

        const cfg = getPluginConfig(api);
        const dbPath = cfg.lanceDbPath?.trim();
        if (!dbPath) return;

        const memberId = cfg.defaultMemberId?.trim();
        if (!memberId) return; // 没有配置默认成员则不注入

        try {
            const sections: string[] = [];
            const today = todayStr();

            // 1. 成员当前身体状态 + 减重进度
            const memberTable = await getTable(dbPath, TABLE_NAMES.FAMILY_MEMBERS);
            const members = await memberTable.filter(`id = '${memberId}'`).limit(1).toArray();
            if (members.length > 0) {
                const m = members[0];
                const current = m.current_weight_kg as number;
                const target = m.target_weight_kg as number;
                const diff = current - target;
                sections.push(
                    `[健康状态] ${m.name}: 当前${current}kg → 目标${target}kg (` +
                    (diff > 0 ? `还差${diff.toFixed(1)}kg` : "已达标") +
                    `), TDEE=${m.tdee}kcal`,
                );
            }

            // 2. 今日饮食摘要
            const mealTable = await getTable(dbPath, TABLE_NAMES.MEALS);
            const todayMeals = await mealTable
                .filter(`member_id = '${memberId}' AND date = '${today}' AND id != '__placeholder__'`)
                .toArray();

            if (todayMeals.length > 0) {
                const totalCal = todayMeals.reduce((s: number, m: LanceDbRow) => s + (m.total_calories as number), 0);
                const tdee = members.length > 0 ? (members[0].tdee as number) : 0;
                const remaining = tdee - totalCal;
                const mealTypes = todayMeals.map((m: LanceDbRow) => {
                    const labels: Record<string, string> = { breakfast: "早", lunch: "午", dinner: "晚", snack: "加" };
                    return `${labels[m.meal_type as string] || m.meal_type}:${m.total_calories}kcal`;
                });
                sections.push(
                    `[今日饮食] ${mealTypes.join(", ")} | 合计${totalCal}kcal` +
                    (tdee > 0 ? ` | 剩余${remaining}kcal` : ""),
                );
            } else {
                sections.push(`[今日饮食] 尚未记录用餐`);
            }

            // 3. 食材库存告警（即将过期 + 低库存）
            const pantryTable = await getTable(dbPath, TABLE_NAMES.PANTRY_ITEMS);
            const pantryItems = await pantryTable.filter("id != '__placeholder__'").toArray();

            const expiryDays = cfg.expiryWarningDays || 3;
            const lowThreshold = cfg.lowStockThreshold || 100;
            const warningDate = new Date();
            warningDate.setDate(warningDate.getDate() + expiryDays);
            const warningStr = warningDate.toISOString().split("T")[0];

            const expiringSoon = pantryItems.filter(
                (p: LanceDbRow) => p.expiry_date && (p.expiry_date as string) <= warningStr && (p.expiry_date as string) >= today,
            );
            const lowStock = pantryItems.filter(
                (p: LanceDbRow) => (p.quantity as number) <= lowThreshold && (p.unit as string) === "g",
            );

            if (expiringSoon.length > 0) {
                sections.push(
                    `[食材预警] 即将过期(${expiryDays}天内): ${expiringSoon.map((p: LanceDbRow) => `${p.name}(${p.expiry_date})`).join(", ")}`,
                );
            }
            if (lowStock.length > 0) {
                sections.push(
                    `[库存不足] ${lowStock.map((p: LanceDbRow) => `${p.name}(${p.quantity}${p.unit})`).join(", ")}`,
                );
            }

            if (sections.length === 0) return;

            return {
                prependContext: "--- 减脂助手上下文 ---\n" + sections.join("\n") + "\n---\n",
            };
        } catch {
            // 静默失败，不影响正常对话
            return;
        }
    });
}
