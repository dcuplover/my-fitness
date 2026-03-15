import { getTable } from "../db/connection";
import { TABLE_NAMES } from "../db/schemas";
import { generateId, nowISO, todayStr } from "../utils/id-gen";
import { formatRows, toolResult } from "../utils/format";
import { calculateBMI } from "../utils/nutrition";
import type { LanceDbRow } from "@lancedb/lancedb";

export function registerBodyTools(api: any, dbPath: string) {
    // ── 记录身体数据 ──
    api.registerTool({
        name: "fitness_body_record",
        description: "记录家庭成员的身体测量数据（体重、体脂率、腰围等），自动计算 BMI，并同步更新成员档案中的当前体重。",
        parameters: {
            type: "object",
            properties: {
                member_id: { type: "string", description: "成员 ID" },
                weight_kg: { type: "number", description: "体重(kg)" },
                body_fat_pct: { type: "number", description: "体脂率(%)，可选" },
                waist_cm: { type: "number", description: "腰围(cm)，可选" },
                date: { type: "string", description: "记录日期(YYYY-MM-DD)，默认今天" },
                notes: { type: "string", description: "备注，可选" },
            },
            required: ["member_id", "weight_kg"],
        },
        async execute(_id: string, params: any) {
            try {
                // 获取成员信息（用于计算 BMI）
                const memberTable = await getTable(dbPath, TABLE_NAMES.FAMILY_MEMBERS);
                const members = await memberTable.filter(`id = '${params.member_id}'`).limit(1).toArray();
                if (members.length === 0) return toolResult(`未找到成员: ${params.member_id}`);
                const member = members[0];

                const bmi = calculateBMI(params.weight_kg, member.height_cm as number);
                const date = params.date || todayStr();

                const table = await getTable(dbPath, TABLE_NAMES.BODY_MEASUREMENTS);
                const row: LanceDbRow = {
                    id: generateId("body"),
                    member_id: params.member_id,
                    member_name: member.name as string,
                    date,
                    weight_kg: params.weight_kg,
                    body_fat_pct: params.body_fat_pct || 0,
                    waist_cm: params.waist_cm || 0,
                    bmi,
                    notes: params.notes || "",
                    created_at: nowISO(),
                };
                await table.add([row]);

                // 同步更新成员档案中的当前体重
                await memberTable.update({
                    where: `id = '${params.member_id}'`,
                    values: { current_weight_kg: params.weight_kg, updated_at: nowISO() },
                });

                const targetWeight = member.target_weight_kg as number;
                const diff = params.weight_kg - targetWeight;
                const progress = diff > 0 ? `距目标还差 ${diff.toFixed(1)}kg` : "已达到目标体重!";

                return toolResult(
                    `已记录 ${member.name} 的身体数据 (${date}):\n` +
                    `体重: ${params.weight_kg}kg | BMI: ${bmi}\n` +
                    (params.body_fat_pct ? `体脂率: ${params.body_fat_pct}%\n` : "") +
                    (params.waist_cm ? `腰围: ${params.waist_cm}cm\n` : "") +
                    progress,
                );
            } catch (error) {
                return toolResult(`记录身体数据失败: ${String(error)}`);
            }
        },
    });

    // ── 查询身体数据 ──
    api.registerTool({
        name: "fitness_body_query",
        description: "查询家庭成员的身体数据记录",
        parameters: {
            type: "object",
            properties: {
                member_id: { type: "string", description: "成员 ID" },
                days: { type: "number", description: "查询最近N天的数据，默认 30" },
            },
            required: ["member_id"],
        },
        async execute(_id: string, params: any) {
            try {
                const table = await getTable(dbPath, TABLE_NAMES.BODY_MEASUREMENTS);
                const days = params.days || 30;
                const startDate = new Date();
                startDate.setDate(startDate.getDate() - days);
                const startStr = startDate.toISOString().split("T")[0];

                const rows = await table
                    .filter(`member_id = '${params.member_id}' AND date >= '${startStr}'`)
                    .toArray();
                const filtered = rows.filter((r: LanceDbRow) => r.id !== "__placeholder__");
                if (filtered.length === 0) return toolResult(`最近 ${days} 天无身体数据记录`);

                const text = formatRows(filtered, ["date", "weight_kg", "bmi", "body_fat_pct", "waist_cm", "notes"]);
                return toolResult(`身体数据 (最近 ${days} 天, ${filtered.length} 条):\n${text}`);
            } catch (error) {
                return toolResult(`查询身体数据失败: ${String(error)}`);
            }
        },
    });

    // ── 身体数据趋势分析 ──
    api.registerTool({
        name: "fitness_body_trend",
        description: "分析家庭成员的体重/体脂趋势，包括变化量、平均值、最高/最低值等",
        parameters: {
            type: "object",
            properties: {
                member_id: { type: "string", description: "成员 ID" },
                days: { type: "number", description: "分析最近N天的数据，默认 30" },
            },
            required: ["member_id"],
        },
        async execute(_id: string, params: any) {
            try {
                const table = await getTable(dbPath, TABLE_NAMES.BODY_MEASUREMENTS);
                const days = params.days || 30;
                const startDate = new Date();
                startDate.setDate(startDate.getDate() - days);
                const startStr = startDate.toISOString().split("T")[0];

                const rows = await table
                    .filter(`member_id = '${params.member_id}' AND date >= '${startStr}'`)
                    .toArray();
                const filtered = rows
                    .filter((r: LanceDbRow) => r.id !== "__placeholder__")
                    .sort((a: LanceDbRow, b: LanceDbRow) => String(a.date).localeCompare(String(b.date)));

                if (filtered.length === 0) return toolResult(`最近 ${days} 天无数据，无法分析趋势`);

                const weights = filtered.map((r: LanceDbRow) => r.weight_kg as number);
                const first = weights[0];
                const last = weights[weights.length - 1];
                const change = last - first;
                const avg = weights.reduce((a, b) => a + b, 0) / weights.length;
                const min = Math.min(...weights);
                const max = Math.max(...weights);

                // 获取成员目标
                const memberTable = await getTable(dbPath, TABLE_NAMES.FAMILY_MEMBERS);
                const members = await memberTable.filter(`id = '${params.member_id}'`).limit(1).toArray();
                const target = members.length > 0 ? (members[0].target_weight_kg as number) : 0;

                let trend = `趋势分析 (最近 ${days} 天, ${filtered.length} 条记录):\n`;
                trend += `起始体重: ${first.toFixed(1)}kg → 当前: ${last.toFixed(1)}kg\n`;
                trend += `变化: ${change > 0 ? "+" : ""}${change.toFixed(1)}kg (${change < 0 ? "减重中" : change > 0 ? "增重中" : "维持"})\n`;
                trend += `平均: ${avg.toFixed(1)}kg | 最低: ${min.toFixed(1)}kg | 最高: ${max.toFixed(1)}kg\n`;
                if (target > 0) {
                    trend += `目标: ${target}kg | 距离目标: ${(last - target).toFixed(1)}kg\n`;
                    if (change < 0 && last > target) {
                        const daysToGoal = Math.ceil(((last - target) / Math.abs(change)) * days);
                        trend += `按当前速度预计还需约 ${daysToGoal} 天达到目标`;
                    }
                }

                return toolResult(trend);
            } catch (error) {
                return toolResult(`分析趋势失败: ${String(error)}`);
            }
        },
    });
}
