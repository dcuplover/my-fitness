import { getTable } from "../db/connection";
import { TABLE_NAMES } from "../db/schemas";
import { generateId, nowISO, todayStr } from "../utils/id-gen";
import { formatRows, toolResult, safeJsonParse } from "../utils/format";
import type { LanceDbRow } from "@lancedb/lancedb";
import type { Dish, DishIngredient } from "../db/schemas";

export function registerMealTools(api: any, dbPath: string) {
    // ── 记录用餐（核心工具：含食材仓库联动扣减） ──
    api.registerTool({
        name: "fitness_meal_record",
        description: "记录一顿用餐。会自动记录食材消耗并从食材仓库中扣减对应数量。dishes 数组中的 ingredients 里的食材名称应与仓库中的名称匹配。",
        parameters: {
            type: "object",
            properties: {
                member_id: { type: "string", description: "用餐成员 ID" },
                member_name: { type: "string", description: "用餐成员姓名" },
                meal_type: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack"], description: "餐次" },
                date: { type: "string", description: "用餐日期(YYYY-MM-DD)，默认今天" },
                dishes: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            name: { type: "string", description: "菜名" },
                            ingredients: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        name: { type: "string" },
                                        quantity: { type: "number" },
                                        unit: { type: "string" },
                                    },
                                },
                            },
                            calories: { type: "number", description: "热量(kcal)" },
                            protein_g: { type: "number" },
                            fat_g: { type: "number" },
                            carbs_g: { type: "number" },
                        },
                    },
                    description: "菜品列表",
                },
                notes: { type: "string", description: "备注，可选" },
            },
            required: ["member_id", "member_name", "meal_type", "dishes"],
        },
        async execute(_id: string, params: any) {
            try {
                const mealDate = params.date || todayStr();
                const dishes: Dish[] = params.dishes || [];
                const mealId = generateId("meal");
                const now = nowISO();

                // 计算总营养
                let totalCalories = 0;
                let totalProtein = 0;
                let totalFat = 0;
                let totalCarbs = 0;
                for (const dish of dishes) {
                    totalCalories += dish.calories || 0;
                    totalProtein += dish.protein_g || 0;
                    totalFat += dish.fat_g || 0;
                    totalCarbs += dish.carbs_g || 0;
                }

                // 写入用餐记录
                const mealTable = await getTable(dbPath, TABLE_NAMES.MEALS);
                const mealRow: LanceDbRow = {
                    id: mealId,
                    member_id: params.member_id,
                    member_name: params.member_name,
                    meal_type: params.meal_type,
                    date: mealDate,
                    dishes: JSON.stringify(dishes),
                    total_calories: totalCalories,
                    total_protein_g: totalProtein,
                    total_fat_g: totalFat,
                    total_carbs_g: totalCarbs,
                    notes: params.notes || "",
                    created_at: now,
                };
                await mealTable.add([mealRow]);

                // 联动扣减食材仓库
                const pantryTable = await getTable(dbPath, TABLE_NAMES.PANTRY_ITEMS);
                const txTable = await getTable(dbPath, TABLE_NAMES.PANTRY_TRANSACTIONS);
                const deductions: string[] = [];

                for (const dish of dishes) {
                    if (!dish.ingredients) continue;
                    for (const ing of dish.ingredients) {
                        try {
                            // 按名称查找仓库食材
                            const items = await pantryTable
                                .filter(`name = '${ing.name}' AND id != '__placeholder__'`)
                                .limit(1)
                                .toArray();
                            if (items.length === 0) {
                                deductions.push(`${ing.name}: 仓库中未找到，跳过扣减`);
                                continue;
                            }
                            const item = items[0];
                            const currentQty = item.quantity as number;
                            const newQty = Math.max(0, currentQty - ing.quantity);

                            // 记录流水
                            await txTable.add([{
                                id: generateId("tx"),
                                pantry_item_id: item.id as string,
                                item_name: ing.name,
                                meal_id: mealId,
                                transaction_type: "consume",
                                quantity: ing.quantity,
                                unit: ing.unit,
                                date: mealDate,
                                created_at: now,
                            }]);

                            // 更新库存
                            if (newQty <= 0) {
                                await pantryTable.delete(`id = '${item.id}'`);
                                deductions.push(`${ing.name}: ${currentQty} → 0 (已用尽)`);
                            } else {
                                await pantryTable.update({
                                    where: `id = '${item.id}'`,
                                    values: { quantity: newQty, updated_at: now },
                                });
                                deductions.push(`${ing.name}: ${currentQty} → ${newQty} ${item.unit}`);
                            }
                        } catch {
                            deductions.push(`${ing.name}: 扣减失败`);
                        }
                    }
                }

                const mealTypeLabels: Record<string, string> = {
                    breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐",
                };
                let result = `已记录 ${params.member_name} 的${mealTypeLabels[params.meal_type] || params.meal_type} (${mealDate}):\n`;
                result += `菜品: ${dishes.map((d: Dish) => d.name).join("、")}\n`;
                result += `热量: ${totalCalories}kcal | 蛋白质: ${totalProtein}g | 脂肪: ${totalFat}g | 碳水: ${totalCarbs}g\n`;
                if (deductions.length > 0) {
                    result += `\n食材扣减:\n${deductions.join("\n")}`;
                }
                return toolResult(result);
            } catch (error) {
                return toolResult(`记录用餐失败: ${String(error)}`);
            }
        },
    });

    // ── 查询用餐历史 ──
    api.registerTool({
        name: "fitness_meal_history",
        description: "查询家庭成员的用餐历史记录",
        parameters: {
            type: "object",
            properties: {
                member_id: { type: "string", description: "成员 ID，可选（不填查全部成员）" },
                date: { type: "string", description: "指定日期(YYYY-MM-DD)，可选" },
                days: { type: "number", description: "查询最近N天，默认 7" },
                meal_type: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack"], description: "筛选餐次，可选" },
            },
        },
        async execute(_id: string, params: any) {
            try {
                const table = await getTable(dbPath, TABLE_NAMES.MEALS);
                let filter = "id != '__placeholder__'";
                if (params?.member_id) filter += ` AND member_id = '${params.member_id}'`;
                if (params?.date) {
                    filter += ` AND date = '${params.date}'`;
                } else {
                    const days = params?.days || 7;
                    const startDate = new Date();
                    startDate.setDate(startDate.getDate() - days);
                    filter += ` AND date >= '${startDate.toISOString().split("T")[0]}'`;
                }
                if (params?.meal_type) filter += ` AND meal_type = '${params.meal_type}'`;

                const rows = await table.filter(filter).toArray();
                if (rows.length === 0) return toolResult("无用餐记录");
                const text = formatRows(rows, [
                    "date", "member_name", "meal_type", "total_calories",
                    "total_protein_g", "total_fat_g", "total_carbs_g", "notes",
                ]);
                return toolResult(`用餐记录 (${rows.length} 条):\n${text}`);
            } catch (error) {
                return toolResult(`查询用餐记录失败: ${String(error)}`);
            }
        },
    });

    // ── 每日饮食摘要 ──
    api.registerTool({
        name: "fitness_meal_daily_summary",
        description: "获取某个成员某天的饮食摘要：各餐次热量和总摄入，与 TDEE 的对比",
        parameters: {
            type: "object",
            properties: {
                member_id: { type: "string", description: "成员 ID" },
                date: { type: "string", description: "日期(YYYY-MM-DD)，默认今天" },
            },
            required: ["member_id"],
        },
        async execute(_id: string, params: any) {
            try {
                const date = params.date || todayStr();
                const mealTable = await getTable(dbPath, TABLE_NAMES.MEALS);
                const rows = await mealTable
                    .filter(`member_id = '${params.member_id}' AND date = '${date}' AND id != '__placeholder__'`)
                    .toArray();

                // 获取成员 TDEE
                const memberTable = await getTable(dbPath, TABLE_NAMES.FAMILY_MEMBERS);
                const members = await memberTable.filter(`id = '${params.member_id}'`).limit(1).toArray();
                const tdee = members.length > 0 ? (members[0].tdee as number) : 0;
                const memberName = members.length > 0 ? members[0].name : params.member_id;

                if (rows.length === 0) return toolResult(`${memberName} 在 ${date} 暂无用餐记录`);

                const mealTypeLabels: Record<string, string> = {
                    breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐",
                };

                let totalCal = 0, totalP = 0, totalF = 0, totalC = 0;
                const mealLines: string[] = [];
                for (const row of rows) {
                    const cal = row.total_calories as number;
                    totalCal += cal;
                    totalP += row.total_protein_g as number;
                    totalF += row.total_fat_g as number;
                    totalC += row.total_carbs_g as number;
                    const label = mealTypeLabels[row.meal_type as string] || row.meal_type;
                    const dishes = safeJsonParse(row.dishes as string, []) as Dish[];
                    const dishNames = dishes.map((d) => d.name).join("、");
                    mealLines.push(`  ${label}: ${dishNames} (${cal}kcal)`);
                }

                let summary = `${memberName} ${date} 饮食摘要:\n`;
                summary += mealLines.join("\n") + "\n";
                summary += `\n总摄入: ${totalCal}kcal | 蛋白质: ${totalP}g | 脂肪: ${totalF}g | 碳水: ${totalC}g`;
                if (tdee > 0) {
                    const diff = totalCal - tdee;
                    summary += `\nTDEE: ${tdee}kcal | ${diff > 0 ? `超出 ${diff}kcal` : `剩余 ${Math.abs(diff)}kcal`}`;
                }

                return toolResult(summary);
            } catch (error) {
                return toolResult(`获取饮食摘要失败: ${String(error)}`);
            }
        },
    });
}
