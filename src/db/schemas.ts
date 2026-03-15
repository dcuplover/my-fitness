// ============================================================
// 所有 LanceDB 表的 TypeScript 类型定义
// ============================================================

/** 家庭成员档案 */
export type FamilyMember = {
    id: string;
    name: string;
    age: number;
    gender: "male" | "female";
    height_cm: number;
    current_weight_kg: number;
    target_weight_kg: number;
    activity_level: "sedentary" | "light" | "moderate" | "active" | "very_active";
    bmr: number;
    tdee: number;
    dietary_restrictions: string;
    allergies: string;
    created_at: string;
    updated_at: string;
};

/** 食材仓库 */
export type PantryItem = {
    id: string;
    name: string;
    category: "蔬菜" | "肉类" | "海鲜" | "调味料" | "主食" | "水果" | "乳制品" | "豆制品" | "蛋类" | "干货" | "饮品" | "其他";
    quantity: number;
    unit: string;
    purchase_date: string;
    expiry_date: string;
    cost: number;
    notes: string;
    created_at: string;
    updated_at: string;
};

/** 食材出入库流水 */
export type PantryTransaction = {
    id: string;
    pantry_item_id: string;
    item_name: string;
    meal_id: string;
    transaction_type: "consume" | "restock";
    quantity: number;
    unit: string;
    date: string;
    created_at: string;
};

/** 菜品中的食材明细 */
export type DishIngredient = {
    name: string;
    quantity: number;
    unit: string;
};

/** 一道菜 */
export type Dish = {
    name: string;
    ingredients: DishIngredient[];
    calories: number;
    protein_g: number;
    fat_g: number;
    carbs_g: number;
};

/** 用餐记录 */
export type Meal = {
    id: string;
    member_id: string;
    member_name: string;
    meal_type: "breakfast" | "lunch" | "dinner" | "snack";
    date: string;
    dishes: string; // JSON 序列化的 Dish[]
    total_calories: number;
    total_protein_g: number;
    total_fat_g: number;
    total_carbs_g: number;
    notes: string;
    created_at: string;
};

/** 食谱中的食材 */
export type RecipeIngredient = {
    name: string;
    quantity: number;
    unit: string;
};

/** 食谱 */
export type Recipe = {
    id: string;
    name: string;
    description: string;
    category: string;
    ingredients: string; // JSON 序列化的 RecipeIngredient[]
    instructions: string;
    calories_per_serving: number;
    protein_per_serving: number;
    fat_per_serving: number;
    carbs_per_serving: number;
    servings: number;
    prep_time_min: number;
    cook_time_min: number;
    tags: string;
    rating: number;
    difficulty: "easy" | "medium" | "hard";
    created_at: string;
    updated_at: string;
};

/** 周菜单计划 */
export type WeeklyMenu = {
    id: string;
    week_start_date: string;
    member_id: string;
    day_of_week: number;
    meal_type: "breakfast" | "lunch" | "dinner" | "snack";
    recipe_id: string;
    recipe_name: string;
    planned_calories: number;
    notes: string;
    status: "planned" | "completed" | "skipped";
    created_at: string;
};

/** 采购清单 */
export type ShoppingList = {
    id: string;
    created_date: string;
    week_start_date: string;
    status: "pending" | "in_progress" | "completed";
    notes: string;
    total_estimated_cost: number;
    created_at: string;
};

/** 采购清单明细 */
export type ShoppingListItem = {
    id: string;
    list_id: string;
    item_name: string;
    category: string;
    planned_quantity: number;
    actual_quantity: number;
    unit: string;
    estimated_unit_price: number;
    actual_unit_price: number;
    estimated_cost: number;
    actual_cost: number;
    is_purchased: boolean;
    store: string;
    notes: string;
};

/** 采购历史 */
export type PurchaseHistory = {
    id: string;
    item_name: string;
    category: string;
    quantity: number;
    unit: string;
    unit_price: number;
    total_cost: number;
    store: string;
    purchase_date: string;
    notes: string;
    created_at: string;
};

/** 运动记录 */
export type Exercise = {
    id: string;
    member_id: string;
    member_name: string;
    date: string;
    exercise_type: "cardio" | "strength" | "flexibility" | "hiit" | "other";
    exercise_name: string;
    duration_min: number;
    calories_burned: number;
    intensity: "low" | "medium" | "high";
    heart_rate_avg: number;
    notes: string;
    created_at: string;
};

/** 运动计划 */
export type ExercisePlan = {
    id: string;
    member_id: string;
    date: string;
    exercise_type: "cardio" | "strength" | "flexibility" | "hiit" | "other";
    exercise_name: string;
    planned_duration_min: number;
    planned_intensity: "low" | "medium" | "high";
    time_slot: string;
    status: "planned" | "completed" | "skipped";
    notes: string;
    created_at: string;
};

/** 身体数据记录 */
export type BodyMeasurement = {
    id: string;
    member_id: string;
    member_name: string;
    date: string;
    weight_kg: number;
    body_fat_pct: number;
    waist_cm: number;
    bmi: number;
    notes: string;
    created_at: string;
};

/** 食材/菜谱评价 */
export type FoodPreference = {
    id: string;
    member_id: string;
    target_type: "ingredient" | "recipe";
    target_name: string;
    rating: number;
    like_dislike: "like" | "dislike" | "neutral";
    notes: string;
    created_at: string;
};

/** 每日饮水记录 */
export type DailyWaterIntake = {
    id: string;
    member_id: string;
    date: string;
    amount_ml: number;
    created_at: string;
};

// ============================================================
// 表名常量
// ============================================================
export const TABLE_NAMES = {
    FAMILY_MEMBERS: "family_members",
    PANTRY_ITEMS: "pantry_items",
    PANTRY_TRANSACTIONS: "pantry_transactions",
    MEALS: "meals",
    RECIPES: "recipes",
    WEEKLY_MENUS: "weekly_menus",
    SHOPPING_LISTS: "shopping_lists",
    SHOPPING_LIST_ITEMS: "shopping_list_items",
    PURCHASE_HISTORY: "purchase_history",
    EXERCISES: "exercises",
    EXERCISE_PLANS: "exercise_plans",
    BODY_MEASUREMENTS: "body_measurements",
    FOOD_PREFERENCES: "food_preferences",
    DAILY_WATER_INTAKE: "daily_water_intake",
} as const;
