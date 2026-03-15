import { getTable } from "../db/connection";
import { TABLE_NAMES } from "../db/schemas";
import { generateId, nowISO } from "../utils/id-gen";
import { toolResult, safeJsonParse, getWeekStartDate } from "../utils/format";
import type { LanceDbRow } from "@lancedb/lancedb";

export function registerShoppingTools(api: any, dbPath: string) {
    // ── 生成采购清单 ──
    api.registerTool({
        name: "fitness_shopping_generate",
        description: "根据未来一周的菜单计划和当前食材库存，生成采购清单。会参考历史采购记录来推荐合理的采购量（因为某些食材无法精准购买到计划克数）。",
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
                const weekStart = params.week_start_date || getWeekStartDate();
                const now = nowISO();

                // 1. 获取本周菜单
                const menuTable = await getTable(dbPath, TABLE_NAMES.WEEKLY_MENUS);
                const menus = await menuTable
                    .filter(`member_id = '${params.member_id}' AND week_start_date = '${weekStart}' AND id != '__placeholder__'`)
                    .toArray();

                if (menus.length === 0) {
                    return toolResult(`${weekStart} 周暂无菜单计划，请先保存菜单`);
                }

                // 2. 根据菜单中的recipe_name查找食谱，汇总所需食材
                const recipeTable = await getTable(dbPath, TABLE_NAMES.RECIPES);
                const neededIngredients: Record<string, { quantity: number; unit: string; category: string }> = {};

                for (const menu of menus) {
                    const recipeName = menu.recipe_name as string;
                    if (!recipeName) continue;
                    const recipes = await recipeTable.filter(`name = '${recipeName}'`).limit(1).toArray();
                    if (recipes.length === 0) continue;

                    const ingredients = safeJsonParse(recipes[0].ingredients as string, []) as any[];
                    for (const ing of ingredients) {
                        const key = ing.name;
                        if (!neededIngredients[key]) {
                            neededIngredients[key] = { quantity: 0, unit: ing.unit || "g", category: "" };
                        }
                        neededIngredients[key].quantity += ing.quantity || 0;
                    }
                }

                // 3. 对比当前库存
                const pantryTable = await getTable(dbPath, TABLE_NAMES.PANTRY_ITEMS);
                const pantryItems = await pantryTable.filter("id != '__placeholder__'").toArray();
                const pantryMap: Record<string, { quantity: number; unit: string; category: string }> = {};
                for (const item of pantryItems) {
                    const name = item.name as string;
                    pantryMap[name] = {
                        quantity: item.quantity as number,
                        unit: item.unit as string,
                        category: item.category as string,
                    };
                }

                // 4. 查询采购历史获取实际采购量参考
                const purchaseTable = await getTable(dbPath, TABLE_NAMES.PURCHASE_HISTORY);
                const purchaseHistory = await purchaseTable.filter("id != '__placeholder__'").toArray();
                const avgPurchaseQty: Record<string, { avgQty: number; avgPrice: number; count: number }> = {};
                for (const ph of purchaseHistory) {
                    const name = ph.item_name as string;
                    if (!avgPurchaseQty[name]) {
                        avgPurchaseQty[name] = { avgQty: 0, avgPrice: 0, count: 0 };
                    }
                    avgPurchaseQty[name].avgQty += ph.quantity as number;
                    avgPurchaseQty[name].avgPrice += ph.unit_price as number;
                    avgPurchaseQty[name].count += 1;
                }
                for (const [, val] of Object.entries(avgPurchaseQty)) {
                    val.avgQty = Math.round(val.avgQty / val.count);
                    val.avgPrice = Math.round((val.avgPrice / val.count) * 100) / 100;
                }

                // 5. 计算需要采购的量
                const listId = generateId("shop");
                const shoppingItems: LanceDbRow[] = [];
                let totalEstimatedCost = 0;

                for (const [name, needed] of Object.entries(neededIngredients)) {
                    const inStock = pantryMap[name]?.quantity || 0;
                    const shortfall = Math.max(0, needed.quantity - inStock);
                    if (shortfall <= 0) continue; // 库存充足

                    const history = avgPurchaseQty[name];
                    // 如果有历史，取历史平均采购量和实际缺口的较大值（因为某些食材最小购买单位大于需求量）
                    const plannedQty = history ? Math.max(shortfall, history.avgQty) : shortfall;
                    const estimatedPrice = history ? history.avgPrice : 0;
                    const estimatedCost = Math.round(plannedQty * estimatedPrice * 100) / 100;
                    totalEstimatedCost += estimatedCost;

                    shoppingItems.push({
                        id: generateId("si"),
                        list_id: listId,
                        item_name: name,
                        category: pantryMap[name]?.category || needed.category || "",
                        planned_quantity: plannedQty,
                        actual_quantity: 0,
                        unit: needed.unit,
                        estimated_unit_price: estimatedPrice,
                        actual_unit_price: 0,
                        estimated_cost: estimatedCost,
                        actual_cost: 0,
                        is_purchased: false,
                        store: "",
                        notes: history
                            ? `历史平均购买: ${history.avgQty}${needed.unit}@${history.avgPrice}元`
                            : "无历史价格参考",
                    });
                }

                if (shoppingItems.length === 0) {
                    return toolResult("当前库存足够覆盖本周菜单，无需采购");
                }

                // 6. 写入数据库
                const listTable = await getTable(dbPath, TABLE_NAMES.SHOPPING_LISTS);
                await listTable.add([{
                    id: listId,
                    created_date: now.split("T")[0],
                    week_start_date: weekStart,
                    status: "pending",
                    notes: "",
                    total_estimated_cost: totalEstimatedCost,
                    created_at: now,
                }]);

                const itemTable = await getTable(dbPath, TABLE_NAMES.SHOPPING_LIST_ITEMS);
                await itemTable.add(shoppingItems);

                // 7. 格式化输出
                let text = `采购清单 (${weekStart} 周, ID: ${listId}):\n`;
                text += `预估总成本: ¥${totalEstimatedCost.toFixed(2)}\n\n`;
                for (const item of shoppingItems) {
                    text += `- ${item.item_name}: ${item.planned_quantity}${item.unit}`;
                    if ((item.estimated_unit_price as number) > 0) {
                        text += ` (约¥${(item.estimated_cost as number).toFixed(2)})`;
                    }
                    if (item.notes) text += ` [${item.notes}]`;
                    text += "\n";
                }

                return toolResult(text);
            } catch (error) {
                return toolResult(`生成采购清单失败: ${String(error)}`);
            }
        },
    });

    // ── 更新采购清单项 ──
    api.registerTool({
        name: "fitness_shopping_update",
        description: "更新采购清单中某一项（如实际购买量、实际价格等）",
        parameters: {
            type: "object",
            properties: {
                item_id: { type: "string", description: "清单项 ID" },
                actual_quantity: { type: "number", description: "实际采购量" },
                actual_unit_price: { type: "number", description: "实际单价" },
                store: { type: "string", description: "购买商店" },
                is_purchased: { type: "boolean", description: "是否已购买" },
            },
            required: ["item_id"],
        },
        async execute(_id: string, params: any) {
            try {
                const table = await getTable(dbPath, TABLE_NAMES.SHOPPING_LIST_ITEMS);
                const updates: Record<string, unknown> = {};
                if (params.actual_quantity !== undefined) updates.actual_quantity = params.actual_quantity;
                if (params.actual_unit_price !== undefined) updates.actual_unit_price = params.actual_unit_price;
                if (params.store !== undefined) updates.store = params.store;
                if (params.is_purchased !== undefined) updates.is_purchased = params.is_purchased;
                if (params.actual_quantity && params.actual_unit_price) {
                    updates.actual_cost = Math.round(params.actual_quantity * params.actual_unit_price * 100) / 100;
                }

                await table.update({ where: `id = '${params.item_id}'`, values: updates });
                return toolResult(`已更新采购清单项 ${params.item_id}`);
            } catch (error) {
                return toolResult(`更新采购清单项失败: ${String(error)}`);
            }
        },
    });

    // ── 完成采购（批量入库） ──
    api.registerTool({
        name: "fitness_shopping_complete",
        description: "标记采购清单为已完成，并将已购买的食材批量添加到食材仓库中，同时记录采购历史。",
        parameters: {
            type: "object",
            properties: {
                list_id: { type: "string", description: "采购清单 ID" },
            },
            required: ["list_id"],
        },
        async execute(_id: string, params: any) {
            try {
                const now = nowISO();
                const today = now.split("T")[0];

                // 获取清单项
                const itemTable = await getTable(dbPath, TABLE_NAMES.SHOPPING_LIST_ITEMS);
                const items = await itemTable
                    .filter(`list_id = '${params.list_id}' AND is_purchased = true`)
                    .toArray();

                if (items.length === 0) return toolResult("该清单无已购买的物品");

                const pantryTable = await getTable(dbPath, TABLE_NAMES.PANTRY_ITEMS);
                const purchaseTable = await getTable(dbPath, TABLE_NAMES.PURCHASE_HISTORY);
                const results: string[] = [];

                for (const item of items) {
                    const qty = (item.actual_quantity as number) || (item.planned_quantity as number);
                    const unitPrice = (item.actual_unit_price as number) || (item.estimated_unit_price as number);
                    const totalCost = Math.round(qty * unitPrice * 100) / 100;
                    const itemName = item.item_name as string;

                    // 添加到食材仓库（或增加已有库存）
                    const existing = await pantryTable
                        .filter(`name = '${itemName}' AND id != '__placeholder__'`)
                        .limit(1)
                        .toArray();

                    if (existing.length > 0) {
                        const newQty = (existing[0].quantity as number) + qty;
                        await pantryTable.update({
                            where: `id = '${existing[0].id}'`,
                            values: { quantity: newQty, cost: (existing[0].cost as number) + totalCost, updated_at: now },
                        });
                        results.push(`${itemName}: 库存 ${existing[0].quantity} → ${newQty} ${item.unit}`);
                    } else {
                        await pantryTable.add([{
                            id: generateId("pantry"),
                            name: itemName,
                            category: item.category || "其他",
                            quantity: qty,
                            unit: item.unit,
                            purchase_date: today,
                            expiry_date: "",
                            cost: totalCost,
                            notes: "",
                            created_at: now,
                            updated_at: now,
                        }]);
                        results.push(`${itemName}: 新入库 ${qty}${item.unit}`);
                    }

                    // 记录采购历史
                    await purchaseTable.add([{
                        id: generateId("ph"),
                        item_name: itemName,
                        category: item.category || "",
                        quantity: qty,
                        unit: item.unit as string,
                        unit_price: unitPrice,
                        total_cost: totalCost,
                        store: item.store || "",
                        purchase_date: today,
                        notes: "",
                        created_at: now,
                    }]);
                }

                // 更新清单状态
                const listTable = await getTable(dbPath, TABLE_NAMES.SHOPPING_LISTS);
                await listTable.update({
                    where: `id = '${params.list_id}'`,
                    values: { status: "completed" },
                });

                let text = `采购清单 ${params.list_id} 已完成，${items.length} 项入库:\n`;
                text += results.join("\n");

                return toolResult(text);
            } catch (error) {
                return toolResult(`完成采购失败: ${String(error)}`);
            }
        },
    });
}
