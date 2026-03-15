import { getTable } from "../db/connection";
import { TABLE_NAMES } from "../db/schemas";
import { generateId, nowISO } from "../utils/id-gen";
import { formatRows, toolResult } from "../utils/format";
import type { LanceDbRow } from "@lancedb/lancedb";

export function registerRecipeTools(api: any, dbPath: string) {
    // ── 添加食谱 ──
    api.registerTool({
        name: "fitness_recipe_add",
        description: "添加一道新食谱到食谱库。包括食材清单、营养成分、做法步骤等。",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: "菜名" },
                description: { type: "string", description: "菜品描述" },
                category: { type: "string", description: "分类(如家常菜/低脂/高蛋白/轻食/汤品/蔬菜/主食等)" },
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
                    description: "食材列表 [{name, quantity, unit}]",
                },
                instructions: { type: "string", description: "做法步骤" },
                calories_per_serving: { type: "number", description: "每份热量(kcal)" },
                protein_per_serving: { type: "number", description: "每份蛋白质(g)" },
                fat_per_serving: { type: "number", description: "每份脂肪(g)" },
                carbs_per_serving: { type: "number", description: "每份碳水(g)" },
                servings: { type: "number", description: "可做几份" },
                prep_time_min: { type: "number", description: "准备时间(分钟)" },
                cook_time_min: { type: "number", description: "烹饪时间(分钟)" },
                tags: { type: "string", description: "标签(逗号分隔)" },
                difficulty: { type: "string", enum: ["easy", "medium", "hard"], description: "难度" },
            },
            required: ["name", "ingredients", "instructions", "calories_per_serving"],
        },
        async execute(_id: string, params: any) {
            try {
                const table = await getTable(dbPath, TABLE_NAMES.RECIPES);
                const now = nowISO();
                const row: LanceDbRow = {
                    id: generateId("recipe"),
                    name: params.name,
                    description: params.description || "",
                    category: params.category || "",
                    ingredients: JSON.stringify(params.ingredients),
                    instructions: params.instructions,
                    calories_per_serving: params.calories_per_serving,
                    protein_per_serving: params.protein_per_serving || 0,
                    fat_per_serving: params.fat_per_serving || 0,
                    carbs_per_serving: params.carbs_per_serving || 0,
                    servings: params.servings || 1,
                    prep_time_min: params.prep_time_min || 0,
                    cook_time_min: params.cook_time_min || 0,
                    tags: params.tags || "",
                    rating: 0,
                    difficulty: params.difficulty || "easy",
                    created_at: now,
                    updated_at: now,
                };
                await table.add([row]);
                return toolResult(`已添加食谱: ${params.name} (${params.calories_per_serving}kcal/份, ID: ${row.id})`);
            } catch (error) {
                return toolResult(`添加食谱失败: ${String(error)}`);
            }
        },
    });

    // ── 搜索食谱 ──
    api.registerTool({
        name: "fitness_recipe_search",
        description: "在食谱库中搜索食谱，支持按名称、分类、标签等搜索",
        parameters: {
            type: "object",
            properties: {
                keyword: { type: "string", description: "搜索关键词" },
                limit: { type: "number", description: "返回数量限制，默认 10" },
            },
            required: ["keyword"],
        },
        async execute(_id: string, params: any) {
            try {
                const table = await getTable(dbPath, TABLE_NAMES.RECIPES);
                const limit = params.limit || 10;
                const rows = await table
                    .search(params.keyword, "fts", ["name", "description", "category", "tags", "instructions"])
                    .limit(limit)
                    .toArray();
                const filtered = rows.filter((r: LanceDbRow) => r.id !== "__placeholder__");
                if (filtered.length === 0) return toolResult(`未找到匹配 "${params.keyword}" 的食谱`);
                const text = formatRows(filtered, [
                    "id", "name", "category", "calories_per_serving",
                    "protein_per_serving", "fat_per_serving", "carbs_per_serving",
                    "servings", "difficulty", "tags",
                ]);
                return toolResult(`食谱搜索结果:\n${text}`);
            } catch (error) {
                return toolResult(`搜索食谱失败: ${String(error)}`);
            }
        },
    });

    // ── 列出食谱 ──
    api.registerTool({
        name: "fitness_recipe_list",
        description: "列出食谱库中的所有食谱（或按分类过滤）",
        parameters: {
            type: "object",
            properties: {
                category: { type: "string", description: "按分类筛选，可选" },
                limit: { type: "number", description: "返回数量限制，默认 20" },
            },
        },
        async execute(_id: string, params: any) {
            try {
                const table = await getTable(dbPath, TABLE_NAMES.RECIPES);
                let filter = "id != '__placeholder__'";
                if (params?.category) {
                    filter += ` AND category = '${params.category}'`;
                }
                const limit = params?.limit || 20;
                const rows = await table.filter(filter).limit(limit).toArray();
                if (rows.length === 0) return toolResult("食谱库为空");
                const text = formatRows(rows, [
                    "id", "name", "category", "calories_per_serving", "difficulty", "tags",
                ]);
                return toolResult(`食谱列表 (${rows.length} 道):\n${text}`);
            } catch (error) {
                return toolResult(`查询食谱失败: ${String(error)}`);
            }
        },
    });

    // ── 评价食谱或食材 ──
    api.registerTool({
        name: "fitness_recipe_rate",
        description: "对食谱或食材进行评价（喜好/评分），用于菜单推荐时参考",
        parameters: {
            type: "object",
            properties: {
                member_id: { type: "string", description: "评价人的成员 ID" },
                target_type: { type: "string", enum: ["ingredient", "recipe"], description: "评价类型" },
                target_name: { type: "string", description: "食谱名或食材名" },
                rating: { type: "number", description: "评分1-5" },
                like_dislike: { type: "string", enum: ["like", "dislike", "neutral"], description: "喜好" },
                notes: { type: "string", description: "评价备注，可选" },
            },
            required: ["member_id", "target_type", "target_name", "rating", "like_dislike"],
        },
        async execute(_id: string, params: any) {
            try {
                const table = await getTable(dbPath, TABLE_NAMES.FOOD_PREFERENCES);
                const row: LanceDbRow = {
                    id: generateId("pref"),
                    member_id: params.member_id,
                    target_type: params.target_type,
                    target_name: params.target_name,
                    rating: Math.min(5, Math.max(1, params.rating)),
                    like_dislike: params.like_dislike,
                    notes: params.notes || "",
                    created_at: nowISO(),
                };
                await table.add([row]);
                const emoji = params.like_dislike === "like" ? "👍" : params.like_dislike === "dislike" ? "👎" : "➖";
                return toolResult(
                    `已记录评价: ${params.target_name} ${emoji} (${params.rating}/5)`,
                );
            } catch (error) {
                return toolResult(`记录评价失败: ${String(error)}`);
            }
        },
    });
}
