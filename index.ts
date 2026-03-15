import * as path from "path";
import { initAllTables, seedRecipesFromJson, importJsonData } from "./src/db/init";
import { getTable, tableExists } from "./src/db/connection";
import { TABLE_NAMES } from "./src/db/schemas";

import { registerMemberTools } from "./src/tools/member-tools";
import { registerPantryTools } from "./src/tools/pantry-tools";
import { registerRecipeTools } from "./src/tools/recipe-tools";
import { registerBodyTools } from "./src/tools/body-tools";
import { registerMealTools } from "./src/tools/meal-tools";
import { registerMenuTools } from "./src/tools/menu-tools";
import { registerShoppingTools } from "./src/tools/shopping-tools";
import { registerPurchaseTools } from "./src/tools/purchase-tools";
import { registerExerciseTools } from "./src/tools/exercise-tools";
import { registerCostTools } from "./src/tools/cost-tools";

import { registerContextInjector } from "./src/hooks/context-injector";
import { registerFitnessCommands } from "./src/commands/fitness-commands";

const PLUGIN_ID = "my-fitness";

export default function (api: any) {
    const cfg = api.config?.plugins?.entries?.[PLUGIN_ID]?.config ?? {};
    const dbPath: string | undefined = cfg.lanceDbPath?.trim();

    const logger = {
        info: (msg: string) => api.log?.info?.(`[my-fitness] ${msg}`) ?? console.log(`[my-fitness] ${msg}`),
        warn: (msg: string) => api.log?.warn?.(`[my-fitness] ${msg}`) ?? console.warn(`[my-fitness] ${msg}`),
    };

    if (!dbPath) {
        logger.warn("未配置 lanceDbPath，插件无法启动");
        return;
    }

    // 异步初始化数据库（不阻塞插件注册）
    (async () => {
        try {
            const created = await initAllTables(dbPath, logger);
            if (created.length > 0) {
                logger.info(`初始化完成，创建了 ${created.length} 张表: ${created.join(", ")}`);
            }

            // 自动导入种子菜谱（仅当 recipes 表刚创建或仅有占位数据时）
            const recipeTable = await getTable(dbPath, TABLE_NAMES.RECIPES);
            const rows = await recipeTable.filter("id != '__placeholder__'").limit(1).toArray();
            if (rows.length === 0) {
                const seedPath = cfg.seedRecipesPath || "./data/seed-recipes.json";
                const resolvedSeed = path.resolve(path.dirname(new URL(import.meta.url).pathname), seedPath);
                const count = await seedRecipesFromJson(dbPath, resolvedSeed, logger);
                if (count > 0) {
                    logger.info(`自动导入 ${count} 道种子菜谱`);
                }
            }
        } catch (error) {
            logger.warn(`数据库初始化失败: ${String(error)}`);
        }
    })();

    // ── 注册所有工具 ──
    registerMemberTools(api, dbPath);
    registerPantryTools(api, dbPath);
    registerRecipeTools(api, dbPath);
    registerBodyTools(api, dbPath);
    registerMealTools(api, dbPath);
    registerMenuTools(api, dbPath);
    registerShoppingTools(api, dbPath);
    registerPurchaseTools(api, dbPath);
    registerExerciseTools(api, dbPath);
    registerCostTools(api, dbPath);

    // ── 注册上下文注入 ──
    registerContextInjector(api);

    // ── 注册斜杠命令 ──
    registerFitnessCommands(api);

    // ── 注册 CLI 命令: fitness-import ──
    api.registerCli({
        name: "fitness-import",
        description: "从 JSON 文件导入数据到指定表",
        args: [
            { name: "type", description: "数据类型/表名", required: true },
            { name: "file", description: "JSON 文件路径", required: true },
        ],
        async handler(args: { type: string; file: string }) {
            const tableMapping: Record<string, string> = {
                recipes: TABLE_NAMES.RECIPES,
                pantry: TABLE_NAMES.PANTRY_ITEMS,
                pantry_items: TABLE_NAMES.PANTRY_ITEMS,
                members: TABLE_NAMES.FAMILY_MEMBERS,
                family_members: TABLE_NAMES.FAMILY_MEMBERS,
                exercises: TABLE_NAMES.EXERCISES,
                meals: TABLE_NAMES.MEALS,
            };

            const tableName = tableMapping[args.type] || args.type;
            const validTables = Object.values(TABLE_NAMES);

            if (!validTables.includes(tableName as any)) {
                return {
                    text: `无效的数据类型: ${args.type}\n可用类型: ${Object.keys(tableMapping).join(", ")}`,
                };
            }

            try {
                const count = await importJsonData(dbPath, tableName, args.file, logger);
                return { text: `成功导入 ${count} 条数据到 ${tableName}` };
            } catch (error) {
                return { text: `导入失败: ${String(error)}` };
            }
        },
    });

    logger.info("插件加载完成");
}
