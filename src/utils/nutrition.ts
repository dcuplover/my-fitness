/**
 * 计算 BMR (基础代谢率) — Mifflin-St Jeor 公式
 * @param weight_kg 体重(kg)
 * @param height_cm 身高(cm)
 * @param age 年龄
 * @param gender "male" | "female"
 * @returns BMR (kcal/day)
 */
export function calculateBMR(
    weight_kg: number,
    height_cm: number,
    age: number,
    gender: "male" | "female",
): number {
    if (gender === "male") {
        return Math.round(10 * weight_kg + 6.25 * height_cm - 5 * age + 5);
    }
    return Math.round(10 * weight_kg + 6.25 * height_cm - 5 * age - 161);
}

/** 活动水平系数 */
const ACTIVITY_MULTIPLIERS: Record<string, number> = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    very_active: 1.9,
};

/**
 * 计算 TDEE (每日总能量消耗)
 * @param bmr 基础代谢率
 * @param activityLevel 活动水平
 * @returns TDEE (kcal/day)
 */
export function calculateTDEE(bmr: number, activityLevel: string): number {
    const multiplier = ACTIVITY_MULTIPLIERS[activityLevel] ?? 1.55;
    return Math.round(bmr * multiplier);
}

/**
 * 计算 BMI
 */
export function calculateBMI(weight_kg: number, height_cm: number): number {
    const height_m = height_cm / 100;
    return Math.round((weight_kg / (height_m * height_m)) * 10) / 10;
}

/**
 * 根据减重目标计算每日推荐热量摄入
 * @param tdee 每日总消耗
 * @param currentWeight 当前体重
 * @param targetWeight 目标体重
 * @returns 推荐每日摄入 (kcal)，最低不低于 BMR 的 80%
 */
export function calculateDailyCalorieTarget(
    tdee: number,
    currentWeight: number,
    targetWeight: number,
): number {
    if (currentWeight <= targetWeight) {
        // 不需要减重，维持
        return tdee;
    }
    // 健康减重：每天减少 500-1000 kcal，对应每周减 0.5-1 kg
    const deficit = Math.min(750, tdee * 0.25); // 最多减少 25% TDEE
    return Math.round(Math.max(tdee - deficit, 1200)); // 最低 1200 kcal
}

/**
 * 计算三大营养素推荐摄入量（减脂模式）
 * @param dailyCalories 每日目标热量
 * @returns { protein_g, fat_g, carbs_g }
 */
export function calculateMacros(dailyCalories: number): {
    protein_g: number;
    fat_g: number;
    carbs_g: number;
} {
    // 减脂推荐比例: 蛋白质 30%, 脂肪 25%, 碳水 45%
    return {
        protein_g: Math.round((dailyCalories * 0.3) / 4),  // 1g 蛋白质 = 4 kcal
        fat_g: Math.round((dailyCalories * 0.25) / 9),     // 1g 脂肪 = 9 kcal
        carbs_g: Math.round((dailyCalories * 0.45) / 4),   // 1g 碳水 = 4 kcal
    };
}
