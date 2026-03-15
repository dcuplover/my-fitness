import { getTable } from "../db/connection";
import { TABLE_NAMES } from "../db/schemas";
import { generateId, nowISO, todayStr } from "../utils/id-gen";
import { toolResult, safeJsonParse, getWeekStartDate } from "../utils/format";
import { calculateDailyCalorieTarget, calculateMacros } from "../utils/nutrition";
import type { LanceDbRow } from "@lancedb/lancedb";

export function registerMenuTools(api: any, dbPath: string) {
    // ── 生成菜单推荐上下文 ──
    api.registerTool({
        name: "fitness_menu_recommend",
        description: "汇总成员近期饮食、身体状态、偏好评价、食材库存等信息，生成结构化的推荐上下文。AI 基于这些数据为成员推荐未来一周的菜单。",
        parameters: {
            type: "object",
            properties: {
                member_id: { type: "string", description: "成员 ID" },
                days_lookback: { type: "number", description: "回看最近几天的饮食记录，默认 7" },
            },
            required: ["member_id"],
        },
        async execute(_id: string, params: any) {
            try {
                const daysBack = params.days_lookback || 7;

                // 1. 获取成员信息
                const memberTable = await getTable(dbPath, TABLE_NAMES.FAMILY_MEMBERS);
                const members = await memberTable.filter(`id = '${params.member_id}'`).limit(1).toArray();
                if (members.length === 0) return toolResult(`未找到成员: ${params.member_id}`);
                const member = members[0];
                const tdee = member.tdee as number;
                const targetCal = calculateDailyCalorieTarget(
                    tdee,
                    member.current_weight_kg as number,
                    member.target_weight_kg as number,
                );
                const macros = calculateMacros(targetCal);

                // 2. 近期饮食记录
                const mealTable = await getTable(dbPath, TABLE_NAMES.MEALS);
                const startDate = new Date();
                startDate.setDate(startDate.getDate() - daysBack);
                const startStr = startDate.toISOString().split("T")[0];
                const recentMeals = await mealTable
                    .filter(`member_id = '${params.member_id}' AND date >= '${startStr}' AND id != '__placeholder__'`)
                    .toArray();

                // 统计近期菜品频次
                const dishFreq: Record<string, number> = {};
                for (const meal of recentMeals) {
                    const dishes = safeJsonParse(meal.dishes as string, []) as any[];
                    for (const d of dishes) {
                        dishFreq[d.name] = (dishFreq[d.name] || 0) + 1;
                    }
                }

                const avgCalories = recentMeals.length > 0
                    ? Math.round(recentMeals.reduce((s, m) => s + (m.total_calories as number), 0) / Math.max(1, daysBack))
                    : 0;

                // 3. 偏好
                const prefTable = await getTable(dbPath, TABLE_NAMES.FOOD_PREFERENCES);
                const prefs = await prefTable
                    .filter(`member_id = '${params.member_id}' AND id != '__placeholder__'`)
                    .toArray();
                const likes = prefs.filter((p: LanceDbRow) => p.like_dislike === "like").map((p: LanceDbRow) => p.target_name);
                const dislikes = prefs.filter((p: LanceDbRow) => p.like_dislike === "dislike").map((p: LanceDbRow) => p.target_name);

                // 4. 当前食材库存
                const pantryTable = await getTable(dbPath, TABLE_NAMES.PANTRY_ITEMS);
                const pantryItems = await pantryTable.filter("id != '__placeholder__'").toArray();
                const pantryList = pantryItems.map((p: LanceDbRow) =>
                    `${p.name}(${p.quantity}${p.unit}, ${p.category})`,
                ).join("、");

                // 5. 食谱库
                const recipeTable = await getTable(dbPath, TABLE_NAMES.RECIPES);
                const recipes = await recipeTable.filter("id != '__placeholder__'").toArray();
                const recipeList = recipes.map((r: LanceDbRow) =>
                    `${r.name}(${r.calories_per_serving}kcal, ${r.category})`,
                ).join("、");

                // 组装上下文
                let ctx = `=== 菜单推荐上下文 ===\n\n`;
                ctx += `【成员信息】\n`;
                ctx += `姓名: ${member.name} | 体重: ${member.current_weight_kg}kg → 目标: ${member.target_weight_kg}kg\n`;
                ctx += `TDEE: ${tdee}kcal | 建议每日摄入: ${targetCal}kcal\n`;
                ctx += `建议宏量: 蛋白质 ${macros.protein_g}g / 脂肪 ${macros.fat_g}g / 碳水 ${macros.carbs_g}g\n`;
                ctx += `饮食限制: ${member.dietary_restrictions || "无"} | 过敏: ${member.allergies || "无"}\n\n`;

                ctx += `【近 ${daysBack} 天饮食】\n`;
                ctx += `平均每日摄入: ${avgCalories}kcal\n`;
                if (Object.keys(dishFreq).length > 0) {
                    const sorted = Object.entries(dishFreq).sort((a, b) => b[1] - a[1]);
                    ctx += `近期菜品: ${sorted.map(([name, cnt]) => `${name}(${cnt}次)`).join("、")}\n`;
                }
                ctx += "\n";

                ctx += `【偏好】\n`;
                ctx += `喜欢: ${likes.length > 0 ? likes.join("、") : "暂无记录"}\n`;
                ctx += `不喜欢: ${dislikes.length > 0 ? dislikes.join("、") : "暂无记录"}\n\n`;

                ctx += `【当前食材库存】\n`;
                ctx += pantryList || "仓库为空";
                ctx += "\n\n";

                ctx += `【食谱库】\n`;
                ctx += recipeList || "食谱库为空";
                ctx += "\n\n";

                ctx += `请根据以上信息，为该成员推荐未来7天的三餐菜单(早/午/晚)。要求:\n`;
                ctx += `1. 每日总热量控制在 ${targetCal}kcal 左右\n`;
                ctx += `2. 优先使用库存食材，减少近期重复的菜品\n`;
                ctx += `3. 尊重偏好和饮食限制，避免过敏食材\n`;
                ctx += `4. 营养均衡，注意三大宏量营养素比例\n`;
                ctx += `5. 可以推荐食谱库中的菜品，也可以推荐新菜品`;

                return toolResult(ctx);
            } catch (error) {
                return toolResult(`生成推荐上下文失败: ${String(error)}`);
            }
        },
    });

    // ── 保存周菜单 ──
    api.registerTool({
        name: "fitness_menu_save",
        description: "保存一周的菜单计划到数据库。可以保存 AI 推荐的菜单。",
        parameters: {
            type: "object",
            properties: {
                member_id: { type: "string", description: "成员 ID" },
                week_start_date: { type: "string", description: "周一日期(YYYY-MM-DD)，默认本周" },
                menus: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            day_of_week: { type: "number", description: "星期几(1=周一, 7=周日)" },
                            meal_type: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack"] },
                            recipe_name: { type: "string", description: "菜名" },
                            planned_calories: { type: "number", description: "计划热量(kcal)" },
                            notes: { type: "string" },
                        },
                    },
                    description: "菜单列表",
                },
            },
            required: ["member_id", "menus"],
        },
        async execute(_id: string, params: any) {
            try {
                const table = await getTable(dbPath, TABLE_NAMES.WEEKLY_MENUS);
                const weekStart = params.week_start_date || getWeekStartDate();
                const now = nowISO();

                const rows: LanceDbRow[] = (params.menus || []).map((m: any) => ({
                    id: generateId("menu"),
                    week_start_date: weekStart,
                    member_id: params.member_id,
                    day_of_week: m.day_of_week,
                    meal_type: m.meal_type,
                    recipe_id: "",
                    recipe_name: m.recipe_name,
                    planned_calories: m.planned_calories || 0,
                    notes: m.notes || "",
                    status: "planned",
                    created_at: now,
                }));

                await table.add(rows);
                return toolResult(`已保存 ${rows.length} 项菜单计划 (周起始: ${weekStart})`);
            } catch (error) {
                return toolResult(`保存菜单失败: ${String(error)}`);
            }
        },
    });

    // ── 获取本周菜单 ──
    api.registerTool({
        name: "fitness_menu_get_week",
        description: "获取指定成员某周的菜单计划",
        parameters: {
            type: "object",
            properties: {
                member_id: { type: "string", description: "成员 ID" },
                week_start_date: { type: "string", description: "周一日期(YYYY-MM-DD)，默认本周" },
            },
            required: ["member_id"],
        },
        async execute(_id: string, params: any) {
            try {
                const table = await getTable(dbPath, TABLE_NAMES.WEEKLY_MENUS);
                const weekStart = params.week_start_date || getWeekStartDate();
                const rows = await table
                    .filter(`member_id = '${params.member_id}' AND week_start_date = '${weekStart}' AND id != '__placeholder__'`)
                    .toArray();

                if (rows.length === 0) return toolResult(`${weekStart} 周暂无菜单计划`);

                const dayLabels = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
                const mealLabels: Record<string, string> = {
                    breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐",
                };

                // 按天和餐次排序
                const sorted = rows.sort((a: LanceDbRow, b: LanceDbRow) => {
                    const dayDiff = (a.day_of_week as number) - (b.day_of_week as number);
                    if (dayDiff !== 0) return dayDiff;
                    const order = ["breakfast", "lunch", "dinner", "snack"];
                    return order.indexOf(a.meal_type as string) - order.indexOf(b.meal_type as string);
                });

                let text = `菜单计划 (${weekStart} 周):\n`;
                let currentDay = 0;
                for (const row of sorted) {
                    const day = row.day_of_week as number;
                    if (day !== currentDay) {
                        currentDay = day;
                        text += `\n${dayLabels[day] || `Day${day}`}:\n`;
                    }
                    const mealLabel = mealLabels[row.meal_type as string] || row.meal_type;
                    text += `  ${mealLabel}: ${row.recipe_name} (${row.planned_calories}kcal) [${row.status}]\n`;
                }

                return toolResult(text);
            } catch (error) {
                return toolResult(`获取菜单失败: ${String(error)}`);
            }
        },
    });
}
