import { getTable } from "../db/connection";
import { TABLE_NAMES } from "../db/schemas";
import { todayStr } from "../utils/id-gen";
import { safeJsonParse, getWeekStartDate } from "../utils/format";
import { calculateBMI, calculateDailyCalorieTarget, calculateMacros } from "../utils/nutrition";
import type { LanceDbRow } from "@lancedb/lancedb";
import type { Dish } from "../db/schemas";

const PLUGIN_ID = "my-fitness";

function getPluginConfig(api: any) {
    return api.config?.plugins?.entries?.[PLUGIN_ID]?.config ?? {};
}

export function registerFitnessCommands(api: any) {
    const cfg = getPluginConfig(api);
    const dbPath = cfg.lanceDbPath?.trim();

    // ── /fitness_report — 综合健康报告 ──
    api.registerCommand({
        name: "fitness_report",
        description: "生成综合健康报告：体重趋势、饮食分析、运动统计、成本摘要",
        async handler(ctx: any) {
            if (!dbPath) return { text: "请先配置 lanceDbPath" };

            try {
                const memberId = cfg.defaultMemberId?.trim();
                if (!memberId) return { text: "请先配置 defaultMemberId" };

                const today = todayStr();
                const weekStart = getWeekStartDate();
                let report = `# 减脂助手 — 健康报告\n`;
                report += `日期: ${today}\n\n`;

                // 1. 成员信息
                const memberTable = await getTable(dbPath, TABLE_NAMES.FAMILY_MEMBERS);
                const members = await memberTable.filter(`id = '${memberId}'`).limit(1).toArray();
                if (members.length === 0) return { text: `未找到成员: ${memberId}` };
                const m = members[0];
                const bmi = calculateBMI(m.current_weight_kg as number, m.height_cm as number);
                const targetCal = calculateDailyCalorieTarget(
                    m.tdee as number,
                    m.current_weight_kg as number,
                    m.target_weight_kg as number,
                );
                const macros = calculateMacros(targetCal);

                report += `## 身体状态\n`;
                report += `- 姓名: ${m.name} | 体重: ${m.current_weight_kg}kg | 目标: ${m.target_weight_kg}kg\n`;
                report += `- BMI: ${bmi} | BMR: ${m.bmr}kcal | TDEE: ${m.tdee}kcal\n`;
                report += `- 建议每日摄入: ${targetCal}kcal (蛋白:${macros.protein_g}g 脂肪:${macros.fat_g}g 碳水:${macros.carbs_g}g)\n\n`;

                // 2. 体重趋势（最近30天）
                const bodyTable = await getTable(dbPath, TABLE_NAMES.BODY_MEASUREMENTS);
                const thirtyDaysAgo = new Date();
                thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                const bodyRows = await bodyTable
                    .filter(`member_id = '${memberId}' AND date >= '${thirtyDaysAgo.toISOString().split("T")[0]}' AND id != '__placeholder__'`)
                    .toArray();
                if (bodyRows.length > 0) {
                    const sorted = bodyRows.sort((a: LanceDbRow, b: LanceDbRow) =>
                        String(a.date).localeCompare(String(b.date)),
                    );
                    const first = sorted[0].weight_kg as number;
                    const last = sorted[sorted.length - 1].weight_kg as number;
                    const change = last - first;
                    report += `## 体重趋势 (30天)\n`;
                    report += `- ${first}kg → ${last}kg (${change > 0 ? "+" : ""}${change.toFixed(1)}kg)\n`;
                    report += `- 记录次数: ${sorted.length}\n\n`;
                }

                // 3. 本周饮食分析
                const mealTable = await getTable(dbPath, TABLE_NAMES.MEALS);
                const weekMeals = await mealTable
                    .filter(`member_id = '${memberId}' AND date >= '${weekStart}' AND id != '__placeholder__'`)
                    .toArray();
                report += `## 本周饮食 (${weekStart}~)\n`;
                if (weekMeals.length > 0) {
                    const totalCal = weekMeals.reduce((s: number, r: LanceDbRow) => s + (r.total_calories as number), 0);
                    const totalP = weekMeals.reduce((s: number, r: LanceDbRow) => s + (r.total_protein_g as number), 0);
                    const totalF = weekMeals.reduce((s: number, r: LanceDbRow) => s + (r.total_fat_g as number), 0);
                    const totalC = weekMeals.reduce((s: number, r: LanceDbRow) => s + (r.total_carbs_g as number), 0);
                    const days = new Set(weekMeals.map((r: LanceDbRow) => r.date)).size;
                    report += `- 总餐数: ${weekMeals.length} | 天数: ${days}\n`;
                    report += `- 总热量: ${totalCal}kcal | 日均: ${Math.round(totalCal / days)}kcal\n`;
                    report += `- 蛋白质: ${totalP}g | 脂肪: ${totalF}g | 碳水: ${totalC}g\n\n`;
                } else {
                    report += `- 本周暂无用餐记录\n\n`;
                }

                // 4. 本周运动
                const exTable = await getTable(dbPath, TABLE_NAMES.EXERCISES);
                const weekExercises = await exTable
                    .filter(`member_id = '${memberId}' AND date >= '${weekStart}' AND id != '__placeholder__'`)
                    .toArray();
                report += `## 本周运动\n`;
                if (weekExercises.length > 0) {
                    const totalMin = weekExercises.reduce((s: number, e: LanceDbRow) => s + (e.duration_min as number), 0);
                    const totalBurn = weekExercises.reduce((s: number, e: LanceDbRow) => s + (e.calories_burned as number), 0);
                    report += `- 运动次数: ${weekExercises.length} | 总时长: ${totalMin}分钟\n`;
                    report += `- 总消耗: ${totalBurn}kcal\n\n`;
                } else {
                    report += `- 本周暂无运动记录\n\n`;
                }

                // 5. 成本摘要
                const purchaseTable = await getTable(dbPath, TABLE_NAMES.PURCHASE_HISTORY);
                const monthStart = today.slice(0, 7) + "-01";
                const monthPurchases = await purchaseTable
                    .filter(`purchase_date >= '${monthStart}' AND id != '__placeholder__'`)
                    .toArray();
                const monthCost = monthPurchases.reduce((s: number, p: LanceDbRow) => s + (p.total_cost as number), 0);
                report += `## 本月采购成本\n`;
                report += `- 采购次数: ${monthPurchases.length} | 总花费: ¥${monthCost.toFixed(2)}\n`;

                return { text: report };
            } catch (error) {
                return { text: `生成报告失败: ${String(error)}` };
            }
        },
    });

    // ── /weekly_plan — 一键生成周计划 ──
    api.registerCommand({
        name: "weekly_plan",
        description: "获取本周菜单和运动计划概览，如果没有则提示生成",
        async handler(ctx: any) {
            if (!dbPath) return { text: "请先配置 lanceDbPath" };

            try {
                const memberId = cfg.defaultMemberId?.trim();
                if (!memberId) return { text: "请先配置 defaultMemberId" };

                const weekStart = getWeekStartDate();
                let text = `# 本周计划 (${weekStart}~)\n\n`;

                // 菜单计划
                const menuTable = await getTable(dbPath, TABLE_NAMES.WEEKLY_MENUS);
                const menus = await menuTable
                    .filter(`member_id = '${memberId}' AND week_start_date = '${weekStart}' AND id != '__placeholder__'`)
                    .toArray();

                const dayLabels = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
                const mealLabels: Record<string, string> = {
                    breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐",
                };

                text += `## 菜单计划\n`;
                if (menus.length > 0) {
                    const sorted = menus.sort((a: LanceDbRow, b: LanceDbRow) => {
                        const dayDiff = (a.day_of_week as number) - (b.day_of_week as number);
                        if (dayDiff !== 0) return dayDiff;
                        const order = ["breakfast", "lunch", "dinner", "snack"];
                        return order.indexOf(a.meal_type as string) - order.indexOf(b.meal_type as string);
                    });
                    let currentDay = 0;
                    for (const row of sorted) {
                        const day = row.day_of_week as number;
                        if (day !== currentDay) {
                            currentDay = day;
                            text += `\n**${dayLabels[day]}:**\n`;
                        }
                        text += `- ${mealLabels[row.meal_type as string]}: ${row.recipe_name} (${row.planned_calories}kcal)\n`;
                    }
                } else {
                    text += `本周暂无菜单计划。\n`;
                    text += `提示: 使用 fitness_menu_recommend 工具获取推荐，然后用 fitness_menu_save 保存。\n`;
                }

                // 运动计划
                text += `\n## 运动计划\n`;
                const planTable = await getTable(dbPath, TABLE_NAMES.EXERCISE_PLANS);
                const plans = await planTable
                    .filter(`member_id = '${memberId}' AND date >= '${weekStart}' AND id != '__placeholder__'`)
                    .toArray();
                if (plans.length > 0) {
                    const sorted = plans.sort((a: LanceDbRow, b: LanceDbRow) =>
                        String(a.date).localeCompare(String(b.date)),
                    );
                    for (const plan of sorted) {
                        const status = plan.status === "completed" ? "✅" : plan.status === "skipped" ? "⏭️" : "⬜";
                        text += `- ${status} ${plan.date} ${plan.time_slot || ""}: ${plan.exercise_name} ${plan.planned_duration_min}分钟 (${plan.planned_intensity})\n`;
                    }
                } else {
                    text += `本周暂无运动计划。\n`;
                    text += `提示: 使用 fitness_exercise_plan 工具生成运动计划。\n`;
                }

                return { text };
            } catch (error) {
                return { text: `获取周计划失败: ${String(error)}` };
            }
        },
    });
}
