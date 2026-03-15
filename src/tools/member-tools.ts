import { getTable } from "../db/connection";
import { TABLE_NAMES } from "../db/schemas";
import { generateId, nowISO } from "../utils/id-gen";
import { formatRows, toolResult } from "../utils/format";
import { calculateBMR, calculateTDEE, calculateBMI } from "../utils/nutrition";
import type { LanceDbRow } from "@lancedb/lancedb";

export function registerMemberTools(api: any, dbPath: string) {
    // ── 添加家庭成员 ──
    api.registerTool({
        name: "fitness_member_add",
        description: "添加一个家庭成员，记录基本身体信息和减重目标。会自动计算 BMR、TDEE 和 BMI。",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: "姓名" },
                age: { type: "number", description: "年龄" },
                gender: { type: "string", enum: ["male", "female"], description: "性别" },
                height_cm: { type: "number", description: "身高(cm)" },
                current_weight_kg: { type: "number", description: "当前体重(kg)" },
                target_weight_kg: { type: "number", description: "目标体重(kg)" },
                activity_level: {
                    type: "string",
                    enum: ["sedentary", "light", "moderate", "active", "very_active"],
                    description: "活动水平: sedentary(久坐), light(轻度), moderate(中度), active(活跃), very_active(非常活跃)",
                },
                dietary_restrictions: { type: "string", description: "饮食限制（如素食、清真等），可选" },
                allergies: { type: "string", description: "过敏食材（逗号分隔），可选" },
            },
            required: ["name", "age", "gender", "height_cm", "current_weight_kg", "target_weight_kg", "activity_level"],
        },
        async execute(_id: string, params: any) {
            try {
                const table = await getTable(dbPath, TABLE_NAMES.FAMILY_MEMBERS);
                const bmr = calculateBMR(params.current_weight_kg, params.height_cm, params.age, params.gender);
                const tdee = calculateTDEE(bmr, params.activity_level);
                const now = nowISO();
                const row: LanceDbRow = {
                    id: generateId("member"),
                    name: params.name,
                    age: params.age,
                    gender: params.gender,
                    height_cm: params.height_cm,
                    current_weight_kg: params.current_weight_kg,
                    target_weight_kg: params.target_weight_kg,
                    activity_level: params.activity_level,
                    bmr,
                    tdee,
                    dietary_restrictions: params.dietary_restrictions || "",
                    allergies: params.allergies || "",
                    created_at: now,
                    updated_at: now,
                };
                await table.add([row]);
                const bmi = calculateBMI(params.current_weight_kg, params.height_cm);
                return toolResult(
                    `已添加家庭成员: ${params.name}\n` +
                    `BMR: ${bmr} kcal/天 | TDEE: ${tdee} kcal/天 | BMI: ${bmi}\n` +
                    `ID: ${row.id}`,
                );
            } catch (error) {
                return toolResult(`添加成员失败: ${String(error)}`);
            }
        },
    });

    // ── 更新家庭成员 ──
    api.registerTool({
        name: "fitness_member_update",
        description: "更新家庭成员的信息（如体重、目标、活动水平等），会自动重新计算 BMR 和 TDEE。",
        parameters: {
            type: "object",
            properties: {
                member_id: { type: "string", description: "成员 ID" },
                current_weight_kg: { type: "number", description: "更新后的体重(kg)" },
                target_weight_kg: { type: "number", description: "更新后的目标体重(kg)" },
                activity_level: { type: "string", enum: ["sedentary", "light", "moderate", "active", "very_active"] },
                age: { type: "number", description: "年龄" },
                dietary_restrictions: { type: "string" },
                allergies: { type: "string" },
            },
            required: ["member_id"],
        },
        async execute(_id: string, params: any) {
            try {
                const table = await getTable(dbPath, TABLE_NAMES.FAMILY_MEMBERS);
                // 获取当前数据
                const rows = await table.filter(`id = '${params.member_id}'`).limit(1).toArray();
                if (rows.length === 0) return toolResult(`未找到成员: ${params.member_id}`);

                const current = rows[0];
                const updates: Record<string, unknown> = { updated_at: nowISO() };
                if (params.current_weight_kg !== undefined) updates.current_weight_kg = params.current_weight_kg;
                if (params.target_weight_kg !== undefined) updates.target_weight_kg = params.target_weight_kg;
                if (params.activity_level !== undefined) updates.activity_level = params.activity_level;
                if (params.age !== undefined) updates.age = params.age;
                if (params.dietary_restrictions !== undefined) updates.dietary_restrictions = params.dietary_restrictions;
                if (params.allergies !== undefined) updates.allergies = params.allergies;

                // 重新计算 BMR/TDEE
                const weight = (updates.current_weight_kg ?? current.current_weight_kg) as number;
                const height = current.height_cm as number;
                const age = (updates.age ?? current.age) as number;
                const gender = current.gender as "male" | "female";
                const activity = (updates.activity_level ?? current.activity_level) as string;
                updates.bmr = calculateBMR(weight, height, age, gender);
                updates.tdee = calculateTDEE(updates.bmr as number, activity);

                await table.update({ where: `id = '${params.member_id}'`, values: updates });
                return toolResult(
                    `已更新成员 ${current.name}: 体重=${weight}kg, BMR=${updates.bmr}, TDEE=${updates.tdee}`,
                );
            } catch (error) {
                return toolResult(`更新成员失败: ${String(error)}`);
            }
        },
    });

    // ── 列出所有家庭成员 ──
    api.registerTool({
        name: "fitness_member_list",
        description: "列出所有已注册的家庭成员及其基本信息",
        parameters: { type: "object", properties: {} },
        async execute() {
            try {
                const table = await getTable(dbPath, TABLE_NAMES.FAMILY_MEMBERS);
                const rows = await table.filter("id != '__placeholder__'").toArray();
                if (rows.length === 0) return toolResult("暂无注册的家庭成员");
                const text = formatRows(rows, [
                    "id", "name", "age", "gender", "height_cm",
                    "current_weight_kg", "target_weight_kg", "bmr", "tdee",
                ]);
                return toolResult(`家庭成员列表:\n${text}`);
            } catch (error) {
                return toolResult(`查询成员失败: ${String(error)}`);
            }
        },
    });

    // ── 获取指定成员详情 ──
    api.registerTool({
        name: "fitness_member_get",
        description: "获取指定家庭成员的详细信息",
        parameters: {
            type: "object",
            properties: {
                member_id: { type: "string", description: "成员 ID 或姓名" },
            },
            required: ["member_id"],
        },
        async execute(_id: string, params: any) {
            try {
                const table = await getTable(dbPath, TABLE_NAMES.FAMILY_MEMBERS);
                let rows = await table.filter(`id = '${params.member_id}'`).limit(1).toArray();
                if (rows.length === 0) {
                    rows = await table.filter(`name = '${params.member_id}'`).limit(1).toArray();
                }
                if (rows.length === 0) return toolResult(`未找到成员: ${params.member_id}`);

                const m = rows[0];
                const bmi = calculateBMI(m.current_weight_kg as number, m.height_cm as number);
                return toolResult(
                    `成员详情:\n` +
                    `姓名: ${m.name} | 性别: ${m.gender} | 年龄: ${m.age}\n` +
                    `身高: ${m.height_cm}cm | 当前体重: ${m.current_weight_kg}kg | 目标体重: ${m.target_weight_kg}kg\n` +
                    `BMI: ${bmi} | BMR: ${m.bmr} kcal/天 | TDEE: ${m.tdee} kcal/天\n` +
                    `活动水平: ${m.activity_level}\n` +
                    `饮食限制: ${m.dietary_restrictions || "无"} | 过敏: ${m.allergies || "无"}\n` +
                    `ID: ${m.id}`,
                );
            } catch (error) {
                return toolResult(`查询成员失败: ${String(error)}`);
            }
        },
    });
}
