import { getTable } from "../db/connection";
import { TABLE_NAMES } from "../db/schemas";
import { generateId, nowISO, todayStr } from "../utils/id-gen";
import { formatRows, toolResult } from "../utils/format";
import type { LanceDbRow } from "@lancedb/lancedb";

export function registerExerciseTools(api: any, dbPath: string) {
    // ── 生成运动计划 ──
    api.registerTool({
        name: "fitness_exercise_plan",
        description: "为成员生成或保存运动计划。根据身体状况和时间安排规划运动项目、时长、强度。",
        parameters: {
            type: "object",
            properties: {
                member_id: { type: "string", description: "成员 ID" },
                plans: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            date: { type: "string", description: "日期(YYYY-MM-DD)" },
                            exercise_type: { type: "string", enum: ["cardio", "strength", "flexibility", "hiit", "other"], description: "运动类型" },
                            exercise_name: { type: "string", description: "运动名称" },
                            planned_duration_min: { type: "number", description: "计划时长(分钟)" },
                            planned_intensity: { type: "string", enum: ["low", "medium", "high"], description: "计划强度" },
                            time_slot: { type: "string", description: "时间段(如 07:00-08:00)" },
                            notes: { type: "string" },
                        },
                    },
                    description: "运动计划列表",
                },
            },
            required: ["member_id", "plans"],
        },
        async execute(_id: string, params: any) {
            try {
                const table = await getTable(dbPath, TABLE_NAMES.EXERCISE_PLANS);
                const now = nowISO();

                const rows: LanceDbRow[] = (params.plans || []).map((p: any) => ({
                    id: generateId("ep"),
                    member_id: params.member_id,
                    date: p.date || todayStr(),
                    exercise_type: p.exercise_type || "other",
                    exercise_name: p.exercise_name,
                    planned_duration_min: p.planned_duration_min || 30,
                    planned_intensity: p.planned_intensity || "medium",
                    time_slot: p.time_slot || "",
                    status: "planned",
                    notes: p.notes || "",
                    created_at: now,
                }));

                await table.add(rows);
                return toolResult(`已保存 ${rows.length} 项运动计划`);
            } catch (error) {
                return toolResult(`保存运动计划失败: ${String(error)}`);
            }
        },
    });

    // ── 记录运动 ──
    api.registerTool({
        name: "fitness_exercise_record",
        description: "记录一次实际完成的运动，包括运动类型、时长、消耗热量等",
        parameters: {
            type: "object",
            properties: {
                member_id: { type: "string", description: "成员 ID" },
                member_name: { type: "string", description: "成员姓名" },
                date: { type: "string", description: "日期(YYYY-MM-DD)，默认今天" },
                exercise_type: { type: "string", enum: ["cardio", "strength", "flexibility", "hiit", "other"], description: "运动类型" },
                exercise_name: { type: "string", description: "运动名称(如跑步、瑜伽、深蹲等)" },
                duration_min: { type: "number", description: "实际运动时长(分钟)" },
                calories_burned: { type: "number", description: "消耗热量(kcal)" },
                intensity: { type: "string", enum: ["low", "medium", "high"], description: "运动强度" },
                heart_rate_avg: { type: "number", description: "平均心率(bpm)，可选" },
                notes: { type: "string", description: "备注，可选" },
            },
            required: ["member_id", "member_name", "exercise_type", "exercise_name", "duration_min", "calories_burned"],
        },
        async execute(_id: string, params: any) {
            try {
                const table = await getTable(dbPath, TABLE_NAMES.EXERCISES);
                const now = nowISO();
                const date = params.date || todayStr();

                const row: LanceDbRow = {
                    id: generateId("ex"),
                    member_id: params.member_id,
                    member_name: params.member_name,
                    date,
                    exercise_type: params.exercise_type,
                    exercise_name: params.exercise_name,
                    duration_min: params.duration_min,
                    calories_burned: params.calories_burned,
                    intensity: params.intensity || "medium",
                    heart_rate_avg: params.heart_rate_avg || 0,
                    notes: params.notes || "",
                    created_at: now,
                };
                await table.add([row]);

                // 如果有对应的运动计划，标记为完成
                const planTable = await getTable(dbPath, TABLE_NAMES.EXERCISE_PLANS);
                const plans = await planTable
                    .filter(`member_id = '${params.member_id}' AND date = '${date}' AND exercise_name = '${params.exercise_name}' AND status = 'planned'`)
                    .limit(1)
                    .toArray();
                if (plans.length > 0) {
                    await planTable.update({
                        where: `id = '${plans[0].id}'`,
                        values: { status: "completed" },
                    });
                }

                return toolResult(
                    `已记录 ${params.member_name} 的运动 (${date}):\n` +
                    `${params.exercise_name} | ${params.duration_min}分钟 | 消耗 ${params.calories_burned}kcal | 强度: ${params.intensity || "medium"}`,
                );
            } catch (error) {
                return toolResult(`记录运动失败: ${String(error)}`);
            }
        },
    });

    // ── 查询运动历史 ──
    api.registerTool({
        name: "fitness_exercise_history",
        description: "查询成员的运动历史记录和运动计划",
        parameters: {
            type: "object",
            properties: {
                member_id: { type: "string", description: "成员 ID" },
                days: { type: "number", description: "查询最近N天，默认 7" },
                include_plans: { type: "boolean", description: "是否包含运动计划，默认 true" },
            },
            required: ["member_id"],
        },
        async execute(_id: string, params: any) {
            try {
                const days = params.days || 7;
                const startDate = new Date();
                startDate.setDate(startDate.getDate() - days);
                const startStr = startDate.toISOString().split("T")[0];
                let result = "";

                // 运动记录
                const exTable = await getTable(dbPath, TABLE_NAMES.EXERCISES);
                const exercises = await exTable
                    .filter(`member_id = '${params.member_id}' AND date >= '${startStr}' AND id != '__placeholder__'`)
                    .toArray();

                if (exercises.length > 0) {
                    const text = formatRows(exercises, [
                        "date", "exercise_name", "exercise_type", "duration_min",
                        "calories_burned", "intensity",
                    ]);
                    const totalCal = exercises.reduce((s: number, e: LanceDbRow) => s + (e.calories_burned as number), 0);
                    const totalMin = exercises.reduce((s: number, e: LanceDbRow) => s + (e.duration_min as number), 0);
                    result += `运动记录 (最近 ${days} 天, ${exercises.length} 次):\n${text}\n`;
                    result += `合计: ${totalMin}分钟, 消耗 ${totalCal}kcal\n`;
                } else {
                    result += `最近 ${days} 天无运动记录\n`;
                }

                // 运动计划
                if (params.include_plans !== false) {
                    const planTable = await getTable(dbPath, TABLE_NAMES.EXERCISE_PLANS);
                    const plans = await planTable
                        .filter(`member_id = '${params.member_id}' AND date >= '${startStr}' AND id != '__placeholder__'`)
                        .toArray();
                    if (plans.length > 0) {
                        const text = formatRows(plans, [
                            "date", "exercise_name", "planned_duration_min",
                            "planned_intensity", "time_slot", "status",
                        ]);
                        result += `\n运动计划 (${plans.length} 项):\n${text}`;
                    }
                }

                return toolResult(result);
            } catch (error) {
                return toolResult(`查询运动历史失败: ${String(error)}`);
            }
        },
    });
}
