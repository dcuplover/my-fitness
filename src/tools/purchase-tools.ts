import { getTable } from "../db/connection";
import { TABLE_NAMES } from "../db/schemas";
import { generateId, nowISO, todayStr } from "../utils/id-gen";
import { formatRows, toolResult } from "../utils/format";
import type { LanceDbRow } from "@lancedb/lancedb";

export function registerPurchaseTools(api: any, dbPath: string) {
    // ── 记录采购（单项快速入库） ──
    api.registerTool({
        name: "fitness_purchase_record",
        description: "记录一次食材采购，同时自动将食材添加到仓库（或增加库存）。适合零散采购时使用。",
        parameters: {
            type: "object",
            properties: {
                item_name: { type: "string", description: "食材名称" },
                category: {
                    type: "string",
                    enum: ["蔬菜", "肉类", "海鲜", "调味料", "主食", "水果", "乳制品", "豆制品", "蛋类", "干货", "饮品", "其他"],
                    description: "食材分类",
                },
                quantity: { type: "number", description: "采购数量" },
                unit: { type: "string", description: "单位" },
                unit_price: { type: "number", description: "单价(元)" },
                store: { type: "string", description: "商店名称，可选" },
                expiry_date: { type: "string", description: "保质期(YYYY-MM-DD)，可选" },
                notes: { type: "string", description: "备注，可选" },
            },
            required: ["item_name", "category", "quantity", "unit", "unit_price"],
        },
        async execute(_id: string, params: any) {
            try {
                const now = nowISO();
                const today = todayStr();
                const totalCost = Math.round(params.quantity * params.unit_price * 100) / 100;

                // 记录采购历史
                const purchaseTable = await getTable(dbPath, TABLE_NAMES.PURCHASE_HISTORY);
                await purchaseTable.add([{
                    id: generateId("ph"),
                    item_name: params.item_name,
                    category: params.category,
                    quantity: params.quantity,
                    unit: params.unit,
                    unit_price: params.unit_price,
                    total_cost: totalCost,
                    store: params.store || "",
                    purchase_date: today,
                    notes: params.notes || "",
                    created_at: now,
                }]);

                // 更新食材仓库
                const pantryTable = await getTable(dbPath, TABLE_NAMES.PANTRY_ITEMS);
                const existing = await pantryTable
                    .filter(`name = '${params.item_name}' AND id != '__placeholder__'`)
                    .limit(1)
                    .toArray();

                if (existing.length > 0) {
                    const newQty = (existing[0].quantity as number) + params.quantity;
                    const newCost = (existing[0].cost as number) + totalCost;
                    await pantryTable.update({
                        where: `id = '${existing[0].id}'`,
                        values: {
                            quantity: newQty,
                            cost: newCost,
                            updated_at: now,
                            ...(params.expiry_date ? { expiry_date: params.expiry_date } : {}),
                        },
                    });
                    return toolResult(
                        `已记录采购并更新库存: ${params.item_name} +${params.quantity}${params.unit} (总库存: ${newQty}${params.unit}, 花费: ¥${totalCost})`,
                    );
                } else {
                    await pantryTable.add([{
                        id: generateId("pantry"),
                        name: params.item_name,
                        category: params.category,
                        quantity: params.quantity,
                        unit: params.unit,
                        purchase_date: today,
                        expiry_date: params.expiry_date || "",
                        cost: totalCost,
                        notes: params.notes || "",
                        created_at: now,
                        updated_at: now,
                    }]);
                    return toolResult(
                        `已记录采购并入库: ${params.item_name} ${params.quantity}${params.unit} (¥${totalCost})`,
                    );
                }
            } catch (error) {
                return toolResult(`记录采购失败: ${String(error)}`);
            }
        },
    });

    // ── 查询采购历史 ──
    api.registerTool({
        name: "fitness_purchase_history",
        description: "查询食材的采购历史，包括采购量、价格、商店等信息",
        parameters: {
            type: "object",
            properties: {
                item_name: { type: "string", description: "按食材名过滤，可选" },
                days: { type: "number", description: "查询最近N天，默认 30" },
                limit: { type: "number", description: "返回数量限制，默认 20" },
            },
        },
        async execute(_id: string, params: any) {
            try {
                const table = await getTable(dbPath, TABLE_NAMES.PURCHASE_HISTORY);
                const days = params?.days || 30;
                const startDate = new Date();
                startDate.setDate(startDate.getDate() - days);
                const startStr = startDate.toISOString().split("T")[0];

                let filter = `id != '__placeholder__' AND purchase_date >= '${startStr}'`;
                if (params?.item_name) {
                    filter += ` AND item_name = '${params.item_name}'`;
                }
                const limit = params?.limit || 20;
                const rows = await table.filter(filter).limit(limit).toArray();
                if (rows.length === 0) return toolResult("无采购记录");

                const text = formatRows(rows, [
                    "purchase_date", "item_name", "quantity", "unit", "unit_price", "total_cost", "store",
                ]);
                return toolResult(`采购历史 (${rows.length} 条):\n${text}`);
            } catch (error) {
                return toolResult(`查询采购历史失败: ${String(error)}`);
            }
        },
    });
}
