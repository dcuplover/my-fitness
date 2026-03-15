import { getTable } from "../db/connection";
import { TABLE_NAMES } from "../db/schemas";
import { generateId, nowISO, todayStr } from "../utils/id-gen";
import { formatRows, toolResult } from "../utils/format";
import type { LanceDbRow } from "@lancedb/lancedb";

export function registerPantryTools(api: any, dbPath: string) {
    // ── 添加食材到仓库 ──
    api.registerTool({
        name: "fitness_pantry_add",
        description: "向食材仓库添加一种食材（采购入库或手动添加），记录名称、分类、数量、单位、成本等信息",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: "食材名称" },
                category: {
                    type: "string",
                    enum: ["蔬菜", "肉类", "海鲜", "调味料", "主食", "水果", "乳制品", "豆制品", "蛋类", "干货", "饮品", "其他"],
                    description: "食材分类",
                },
                quantity: { type: "number", description: "数量" },
                unit: { type: "string", description: "单位(g/kg/个/ml/L/包/瓶等)" },
                cost: { type: "number", description: "购买成本(元)，可选" },
                expiry_date: { type: "string", description: "保质期截止日期(YYYY-MM-DD)，可选" },
                notes: { type: "string", description: "备注，可选" },
            },
            required: ["name", "category", "quantity", "unit"],
        },
        async execute(_id: string, params: any) {
            try {
                const table = await getTable(dbPath, TABLE_NAMES.PANTRY_ITEMS);
                const now = nowISO();
                const row: LanceDbRow = {
                    id: generateId("pantry"),
                    name: params.name,
                    category: params.category,
                    quantity: params.quantity,
                    unit: params.unit,
                    purchase_date: todayStr(),
                    expiry_date: params.expiry_date || "",
                    cost: params.cost || 0,
                    notes: params.notes || "",
                    created_at: now,
                    updated_at: now,
                };
                await table.add([row]);
                return toolResult(`已添加食材: ${params.name} ${params.quantity}${params.unit} (ID: ${row.id})`);
            } catch (error) {
                return toolResult(`添加食材失败: ${String(error)}`);
            }
        },
    });

    // ── 扣减/移除食材 ──
    api.registerTool({
        name: "fitness_pantry_remove",
        description: "从食材仓库扣减指定数量的食材。如果扣减后数量为0，则自动删除该食材记录。",
        parameters: {
            type: "object",
            properties: {
                item_id: { type: "string", description: "食材 ID" },
                quantity: { type: "number", description: "要扣减的数量" },
                reason: { type: "string", description: "扣减原因(如：做菜消耗、过期丢弃等)，可选" },
            },
            required: ["item_id", "quantity"],
        },
        async execute(_id: string, params: any) {
            try {
                const table = await getTable(dbPath, TABLE_NAMES.PANTRY_ITEMS);
                const rows = await table.filter(`id = '${params.item_id}'`).limit(1).toArray();
                if (rows.length === 0) return toolResult(`未找到食材: ${params.item_id}`);

                const item = rows[0];
                const currentQty = item.quantity as number;
                const newQty = currentQty - params.quantity;

                if (newQty <= 0) {
                    await table.delete(`id = '${params.item_id}'`);
                    return toolResult(`食材 ${item.name} 已用尽并移除`);
                }

                await table.update({
                    where: `id = '${params.item_id}'`,
                    values: { quantity: newQty, updated_at: nowISO() },
                });
                return toolResult(`食材 ${item.name}: ${currentQty} → ${newQty} ${item.unit}`);
            } catch (error) {
                return toolResult(`扣减食材失败: ${String(error)}`);
            }
        },
    });

    // ── 更新食材信息 ──
    api.registerTool({
        name: "fitness_pantry_update",
        description: "更新食材仓库中某种食材的信息（如数量、保质期等）",
        parameters: {
            type: "object",
            properties: {
                item_id: { type: "string", description: "食材 ID" },
                quantity: { type: "number", description: "新数量" },
                expiry_date: { type: "string", description: "新的保质期(YYYY-MM-DD)" },
                notes: { type: "string", description: "备注" },
            },
            required: ["item_id"],
        },
        async execute(_id: string, params: any) {
            try {
                const table = await getTable(dbPath, TABLE_NAMES.PANTRY_ITEMS);
                const updates: Record<string, unknown> = { updated_at: nowISO() };
                if (params.quantity !== undefined) updates.quantity = params.quantity;
                if (params.expiry_date !== undefined) updates.expiry_date = params.expiry_date;
                if (params.notes !== undefined) updates.notes = params.notes;

                await table.update({ where: `id = '${params.item_id}'`, values: updates });
                return toolResult(`已更新食材 ${params.item_id}`);
            } catch (error) {
                return toolResult(`更新食材失败: ${String(error)}`);
            }
        },
    });

    // ── 列出食材库存 ──
    api.registerTool({
        name: "fitness_pantry_list",
        description: "列出当前食材仓库的所有库存。可按分类过滤。",
        parameters: {
            type: "object",
            properties: {
                category: { type: "string", description: "按分类筛选，可选" },
            },
        },
        async execute(_id: string, params: any) {
            try {
                const table = await getTable(dbPath, TABLE_NAMES.PANTRY_ITEMS);
                let filter = "id != '__placeholder__'";
                if (params?.category) {
                    filter += ` AND category = '${params.category}'`;
                }
                const rows = await table.filter(filter).toArray();
                if (rows.length === 0) return toolResult("食材仓库为空");
                const text = formatRows(rows, ["id", "name", "category", "quantity", "unit", "expiry_date", "cost"]);
                return toolResult(`食材库存 (${rows.length} 种):\n${text}`);
            } catch (error) {
                return toolResult(`查询食材失败: ${String(error)}`);
            }
        },
    });

    // ── 搜索食材 ──
    api.registerTool({
        name: "fitness_pantry_search",
        description: "在食材仓库中按名称搜索食材",
        parameters: {
            type: "object",
            properties: {
                keyword: { type: "string", description: "搜索关键词" },
            },
            required: ["keyword"],
        },
        async execute(_id: string, params: any) {
            try {
                const table = await getTable(dbPath, TABLE_NAMES.PANTRY_ITEMS);
                const rows = await table.search(params.keyword, "fts", ["name", "category", "notes"]).limit(10).toArray();
                const filtered = rows.filter((r: LanceDbRow) => r.id !== "__placeholder__");
                if (filtered.length === 0) return toolResult(`未找到匹配 "${params.keyword}" 的食材`);
                const text = formatRows(filtered, ["id", "name", "category", "quantity", "unit", "expiry_date"]);
                return toolResult(`搜索结果:\n${text}`);
            } catch (error) {
                return toolResult(`搜索食材失败: ${String(error)}`);
            }
        },
    });
}
