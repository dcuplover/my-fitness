import { getDb, tableExists, getTable, invalidateTableCache } from "./connection";
import { TABLE_NAMES } from "./schemas";
import type { LanceDbRow } from "@lancedb/lancedb";

const PLACEHOLDER_ROWS: Record<string, LanceDbRow> = {
    [TABLE_NAMES.FAMILY_MEMBERS]: {
        id: "__placeholder__", name: "", age: 0, gender: "male", height_cm: 0,
        current_weight_kg: 0, target_weight_kg: 0, activity_level: "moderate",
        bmr: 0, tdee: 0, dietary_restrictions: "", allergies: "",
        created_at: "", updated_at: "",
    },
    [TABLE_NAMES.PANTRY_ITEMS]: {
        id: "__placeholder__", name: "", category: "其他", quantity: 0, unit: "g",
        purchase_date: "", expiry_date: "", cost: 0, notes: "",
        created_at: "", updated_at: "",
    },
    [TABLE_NAMES.PANTRY_TRANSACTIONS]: {
        id: "__placeholder__", pantry_item_id: "", item_name: "", meal_id: "",
        transaction_type: "consume", quantity: 0, unit: "g", date: "",
        created_at: "",
    },
    [TABLE_NAMES.MEALS]: {
        id: "__placeholder__", member_id: "", member_name: "", meal_type: "lunch",
        date: "", dishes: "[]", total_calories: 0, total_protein_g: 0,
        total_fat_g: 0, total_carbs_g: 0, notes: "", created_at: "",
    },
    [TABLE_NAMES.RECIPES]: {
        id: "__placeholder__", name: "", description: "", category: "",
        ingredients: "[]", instructions: "", calories_per_serving: 0,
        protein_per_serving: 0, fat_per_serving: 0, carbs_per_serving: 0,
        servings: 1, prep_time_min: 0, cook_time_min: 0, tags: "",
        rating: 0, difficulty: "easy", created_at: "", updated_at: "",
    },
    [TABLE_NAMES.WEEKLY_MENUS]: {
        id: "__placeholder__", week_start_date: "", member_id: "", day_of_week: 1,
        meal_type: "lunch", recipe_id: "", recipe_name: "", planned_calories: 0,
        notes: "", status: "planned", created_at: "",
    },
    [TABLE_NAMES.SHOPPING_LISTS]: {
        id: "__placeholder__", created_date: "", week_start_date: "",
        status: "pending", notes: "", total_estimated_cost: 0, created_at: "",
    },
    [TABLE_NAMES.SHOPPING_LIST_ITEMS]: {
        id: "__placeholder__", list_id: "", item_name: "", category: "",
        planned_quantity: 0, actual_quantity: 0, unit: "g",
        estimated_unit_price: 0, actual_unit_price: 0, estimated_cost: 0,
        actual_cost: 0, is_purchased: false, store: "", notes: "",
    },
    [TABLE_NAMES.PURCHASE_HISTORY]: {
        id: "__placeholder__", item_name: "", category: "", quantity: 0,
        unit: "g", unit_price: 0, total_cost: 0, store: "",
        purchase_date: "", notes: "", created_at: "",
    },
    [TABLE_NAMES.EXERCISES]: {
        id: "__placeholder__", member_id: "", member_name: "", date: "",
        exercise_type: "cardio", exercise_name: "", duration_min: 0,
        calories_burned: 0, intensity: "medium", heart_rate_avg: 0,
        notes: "", created_at: "",
    },
    [TABLE_NAMES.EXERCISE_PLANS]: {
        id: "__placeholder__", member_id: "", date: "", exercise_type: "cardio",
        exercise_name: "", planned_duration_min: 0, planned_intensity: "medium",
        time_slot: "", status: "planned", notes: "", created_at: "",
    },
    [TABLE_NAMES.BODY_MEASUREMENTS]: {
        id: "__placeholder__", member_id: "", member_name: "", date: "",
        weight_kg: 0, body_fat_pct: 0, waist_cm: 0, bmi: 0,
        notes: "", created_at: "",
    },
    [TABLE_NAMES.FOOD_PREFERENCES]: {
        id: "__placeholder__", member_id: "", target_type: "ingredient",
        target_name: "", rating: 0, like_dislike: "neutral", notes: "",
        created_at: "",
    },
    [TABLE_NAMES.DAILY_WATER_INTAKE]: {
        id: "__placeholder__", member_id: "", date: "", amount_ml: 0,
        created_at: "",
    },
};

// 需要建立 FTS 索引的表及其列
const FTS_INDEX_CONFIG: Record<string, string[]> = {
    [TABLE_NAMES.PANTRY_ITEMS]: ["name", "category", "notes"],
    [TABLE_NAMES.RECIPES]: ["name", "description", "category", "tags", "instructions"],
    [TABLE_NAMES.MEALS]: ["member_name", "notes"],
    [TABLE_NAMES.EXERCISES]: ["exercise_name", "notes"],
    [TABLE_NAMES.PURCHASE_HISTORY]: ["item_name", "store"],
};

/**
 * 初始化所有表（不存在则创建 + 建 FTS 索引）
 * 返回已创建的表名列表
 */
export async function initAllTables(
    dbPath: string,
    logger: { info: (msg: string) => void; warn: (msg: string) => void },
): Promise<string[]> {
    const db = await getDb(dbPath);
    const existingTables = await db.tableNames();
    const createdTables: string[] = [];

    for (const tableName of Object.values(TABLE_NAMES)) {
        if (existingTables.includes(tableName)) {
            continue;
        }

        const placeholder = PLACEHOLDER_ROWS[tableName];
        if (!placeholder) {
            logger.warn(`未找到表 ${tableName} 的占位数据定义，跳过创建`);
            continue;
        }

        try {
            await db.createTable(tableName, [placeholder]);
            createdTables.push(tableName);
            logger.info(`创建表: ${tableName}`);

            // 建立 FTS 索引
            const ftsColumns = FTS_INDEX_CONFIG[tableName];
            if (ftsColumns) {
                const table = await db.openTable(tableName);
                for (const col of ftsColumns) {
                    try {
                        await table.createIndex(col, { config: { inner: "FTS" }, replace: true });
                    } catch {
                        // 某些列可能不支持 FTS，忽略
                    }
                }
                logger.info(`为表 ${tableName} 创建 FTS 索引: ${ftsColumns.join(", ")}`);
            }
        } catch (error) {
            logger.warn(`创建表 ${tableName} 失败: ${String(error)}`);
        }
    }

    return createdTables;
}

/**
 * 从 JSON 文件导入种子菜谱到 recipes 表
 */
export async function seedRecipesFromJson(
    dbPath: string,
    jsonPath: string,
    logger: { info: (msg: string) => void; warn: (msg: string) => void },
): Promise<number> {
    const fs = await import("fs");
    const path = await import("path");

    const resolvedPath = path.resolve(jsonPath);
    if (!fs.existsSync(resolvedPath)) {
        logger.warn(`种子菜谱文件不存在: ${resolvedPath}`);
        return 0;
    }

    const raw = fs.readFileSync(resolvedPath, "utf-8");
    const recipes: any[] = JSON.parse(raw);

    if (!Array.isArray(recipes) || recipes.length === 0) {
        logger.warn("种子菜谱文件为空或格式错误");
        return 0;
    }

    const table = await getTable(dbPath, TABLE_NAMES.RECIPES);
    const now = new Date().toISOString();

    const rows: LanceDbRow[] = recipes.map((r, i) => ({
        id: r.id || `seed-recipe-${String(i + 1).padStart(3, "0")}`,
        name: r.name || "",
        description: r.description || "",
        category: r.category || "",
        ingredients: typeof r.ingredients === "string" ? r.ingredients : JSON.stringify(r.ingredients || []),
        instructions: r.instructions || "",
        calories_per_serving: r.calories_per_serving || 0,
        protein_per_serving: r.protein_per_serving || 0,
        fat_per_serving: r.fat_per_serving || 0,
        carbs_per_serving: r.carbs_per_serving || 0,
        servings: r.servings || 1,
        prep_time_min: r.prep_time_min || 0,
        cook_time_min: r.cook_time_min || 0,
        tags: r.tags || "",
        rating: r.rating || 0,
        difficulty: r.difficulty || "easy",
        created_at: now,
        updated_at: now,
    }));

    await table.add(rows);
    logger.info(`成功导入 ${rows.length} 道种子菜谱`);
    return rows.length;
}

/**
 * 通用 JSON 数据导入函数
 */
export async function importJsonData(
    dbPath: string,
    tableName: string,
    jsonPath: string,
    logger: { info: (msg: string) => void; warn: (msg: string) => void },
): Promise<number> {
    const fs = await import("fs");
    const path = await import("path");

    const resolvedPath = path.resolve(jsonPath);
    if (!fs.existsSync(resolvedPath)) {
        logger.warn(`导入文件不存在: ${resolvedPath}`);
        return 0;
    }

    const raw = fs.readFileSync(resolvedPath, "utf-8");
    const data: any[] = JSON.parse(raw);

    if (!Array.isArray(data) || data.length === 0) {
        logger.warn("导入文件为空或格式错误");
        return 0;
    }

    // 验证表是否存在
    if (!(await tableExists(dbPath, tableName))) {
        logger.warn(`表 ${tableName} 不存在，请先初始化数据库`);
        return 0;
    }

    const table = await getTable(dbPath, tableName);
    const now = new Date().toISOString();

    // 为每条记录补充时间戳
    const rows: LanceDbRow[] = data.map((item) => {
        const row = { ...item };
        if (!row.created_at) row.created_at = now;
        if (!row.updated_at && "updated_at" in (PLACEHOLDER_ROWS[tableName] || {})) {
            row.updated_at = now;
        }
        // 将对象类型的字段序列化为 JSON 字符串
        for (const [key, value] of Object.entries(row)) {
            if (typeof value === "object" && value !== null && !Array.isArray(value)) {
                row[key] = JSON.stringify(value);
            }
            if (Array.isArray(value)) {
                row[key] = JSON.stringify(value);
            }
        }
        return row;
    });

    await table.add(rows);
    logger.info(`成功导入 ${rows.length} 条数据到表 ${tableName}`);
    return rows.length;
}
