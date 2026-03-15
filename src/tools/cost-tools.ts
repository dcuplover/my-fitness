import { getTable } from "../db/connection";
import { TABLE_NAMES } from "../db/schemas";
import { todayStr } from "../utils/id-gen";
import { toolResult } from "../utils/format";
import type { LanceDbRow } from "@lancedb/lancedb";

export function registerCostTools(api: any, dbPath: string) {
    // ── 成本统计 ──
    api.registerTool({
        name: "fitness_cost_summary",
        description: "统计食材采购成本、每餐消耗成本、运动时间成本。支持按天/周/月维度查看。",
        parameters: {
            type: "object",
            properties: {
                period: {
                    type: "string",
                    enum: ["day", "week", "month"],
                    description: "统计周期: day(今天), week(本周), month(本月)",
                },
                member_id: { type: "string", description: "按成员筛选，可选（不填统计全家）" },
            },
            required: ["period"],
        },
        async execute(_id: string, params: any) {
            try {
                const today = todayStr();
                let startDate: string;
                let periodLabel: string;

                switch (params.period) {
                    case "day":
                        startDate = today;
                        periodLabel = `今日 (${today})`;
                        break;
                    case "week": {
                        const d = new Date();
                        const day = d.getDay();
                        const diff = day === 0 ? 6 : day - 1;
                        d.setDate(d.getDate() - diff);
                        startDate = d.toISOString().split("T")[0];
                        periodLabel = `本周 (${startDate} ~ ${today})`;
                        break;
                    }
                    case "month":
                        startDate = today.slice(0, 7) + "-01";
                        periodLabel = `本月 (${startDate} ~ ${today})`;
                        break;
                    default:
                        startDate = today;
                        periodLabel = today;
                }

                // 1. 采购成本
                const purchaseTable = await getTable(dbPath, TABLE_NAMES.PURCHASE_HISTORY);
                const purchases = await purchaseTable
                    .filter(`purchase_date >= '${startDate}' AND id != '__placeholder__'`)
                    .toArray();
                const totalPurchaseCost = purchases.reduce(
                    (s: number, p: LanceDbRow) => s + (p.total_cost as number),
                    0,
                );

                // 2. 用餐统计
                const mealTable = await getTable(dbPath, TABLE_NAMES.MEALS);
                let mealFilter = `date >= '${startDate}' AND id != '__placeholder__'`;
                if (params.member_id) mealFilter += ` AND member_id = '${params.member_id}'`;
                const meals = await mealTable.filter(mealFilter).toArray();
                const totalMeals = meals.length;
                const totalCalories = meals.reduce(
                    (s: number, m: LanceDbRow) => s + (m.total_calories as number),
                    0,
                );

                // 简单估算每餐成本: 总采购成本 / 总餐数
                const costPerMeal = totalMeals > 0 ? totalPurchaseCost / totalMeals : 0;

                // 3. 运动时间统计
                const exTable = await getTable(dbPath, TABLE_NAMES.EXERCISES);
                let exFilter = `date >= '${startDate}' AND id != '__placeholder__'`;
                if (params.member_id) exFilter += ` AND member_id = '${params.member_id}'`;
                const exercises = await exTable.filter(exFilter).toArray();
                const totalExMinutes = exercises.reduce(
                    (s: number, e: LanceDbRow) => s + (e.duration_min as number),
                    0,
                );
                const totalExCalories = exercises.reduce(
                    (s: number, e: LanceDbRow) => s + (e.calories_burned as number),
                    0,
                );

                // 4. 格式化输出
                let text = `成本统计 — ${periodLabel}\n`;
                text += `${"─".repeat(35)}\n`;
                text += `\n【采购成本】\n`;
                text += `  采购次数: ${purchases.length} 次\n`;
                text += `  总花费: ¥${totalPurchaseCost.toFixed(2)}\n`;
                text += `\n【饮食】\n`;
                text += `  总餐数: ${totalMeals} 顿\n`;
                text += `  总热量摄入: ${totalCalories} kcal\n`;
                text += `  平均每餐成本: ¥${costPerMeal.toFixed(2)}\n`;
                text += `  平均每餐热量: ${totalMeals > 0 ? Math.round(totalCalories / totalMeals) : 0} kcal\n`;
                text += `\n【运动】\n`;
                text += `  运动次数: ${exercises.length} 次\n`;
                text += `  总运动时间: ${totalExMinutes} 分钟 (${(totalExMinutes / 60).toFixed(1)} 小时)\n`;
                text += `  总消耗热量: ${totalExCalories} kcal\n`;
                text += `\n【净热量平衡】\n`;
                text += `  摄入 ${totalCalories} kcal - 运动消耗 ${totalExCalories} kcal = 净摄入 ${totalCalories - totalExCalories} kcal`;

                return toolResult(text);
            } catch (error) {
                return toolResult(`成本统计失败: ${String(error)}`);
            }
        },
    });
}
