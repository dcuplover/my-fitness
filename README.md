# my-fitness — OpenClaw 减脂助手插件

家庭健康管理插件，帮助你和家人追踪体重、记录饮食、规划运动、管理食材采购并控制成本。

## 安装

1. 将插件目录放入 OpenClaw 插件目录（通常为 `~/.openclaw/workspace/plugins/my-fitness`）
2. 安装依赖：
   ```bash
   cd my-fitness
   npm install
   ```
3. 在 OpenClaw 配置中启用插件并设置 `lanceDbPath`

## 配置

在 OpenClaw 的插件配置中添加以下内容：

```json
{
  "my-fitness": {
    "config": {
      "lanceDbPath": "/path/to/your/lancedb",
      "defaultMemberId": "你的成员ID",
      "calorieWarningThreshold": 2500,
      "lowStockThreshold": 100,
      "expiryWarningDays": 3,
      "costCurrency": "CNY",
      "seedRecipesPath": "./data/seed-recipes.json"
    }
  }
}
```

| 配置项 | 类型 | 必填 | 说明 |
|--------|------|:----:|------|
| `lanceDbPath` | string | ✓ | LanceDB 数据库存储路径 |
| `defaultMemberId` | string | | 默认成员 ID，设置后自动注入健康上下文 |
| `calorieWarningThreshold` | number | | 每日热量超标警告阈值 (kcal)，默认 2500 |
| `lowStockThreshold` | number | | 食材低库存预警阈值 (g)，默认 100 |
| `expiryWarningDays` | integer | | 食材过期预警天数，默认 3 |
| `costCurrency` | string | | 货币单位，默认 CNY |
| `seedRecipesPath` | string | | 预置菜谱 JSON 路径，默认 `data/seed-recipes.json` |

## 快速开始

### 1. 添加家庭成员

```
请帮我添加成员：张三，男，30岁，身高175cm，体重80kg，目标70kg，中等运动量
```

插件会自动计算 BMR、TDEE 和 BMI。

### 2. 记录体重

```
记录一下今天的体重 79.5kg，体脂率 22%
```

### 3. 记录三餐

```
记录今天的午餐：糙米饭配牛肉西兰花，用了200g牛肉、150g西兰花、100g糙米
```

插件会自动从食材库扣减用量并计算营养摄入。

### 4. 获取菜单推荐

```
帮我推荐下周的减脂菜单
```

### 5. 查看健康报告

输入 `/fitness_report` 获取综合健康报告，包括体重趋势、饮食分析、运动统计和成本摘要。

## 功能一览

### AI 工具（31个）

#### 成员管理
| 工具名 | 说明 |
|--------|------|
| `fitness_member_add` | 添加家庭成员，自动计算 BMR/TDEE/BMI |
| `fitness_member_update` | 更新成员信息，自动重算代谢数据 |
| `fitness_member_list` | 列出所有成员 |
| `fitness_member_get` | 查看成员详情（支持按 ID 或姓名查询） |

#### 食材库管理
| 工具名 | 说明 |
|--------|------|
| `fitness_pantry_add` | 添加食材入库（数量、单位、费用、保质期） |
| `fitness_pantry_remove` | 扣减食材用量，归零自动删除 |
| `fitness_pantry_update` | 更新食材信息 |
| `fitness_pantry_list` | 查看库存（支持按分类筛选） |
| `fitness_pantry_search` | 全文搜索食材 |

#### 菜谱管理
| 工具名 | 说明 |
|--------|------|
| `fitness_recipe_add` | 添加菜谱（食材、营养、烹饪步骤） |
| `fitness_recipe_search` | 按名称/分类/标签/食材搜索菜谱 |
| `fitness_recipe_list` | 列出所有菜谱（支持分类筛选） |
| `fitness_recipe_rate` | 对菜谱/食材打分，记录偏好 |

#### 身体数据
| 工具名 | 说明 |
|--------|------|
| `fitness_body_record` | 记录体重/体脂率/腰围，自动算 BMI 并同步成员档案 |
| `fitness_body_query` | 查询体测历史记录 |
| `fitness_body_trend` | 体重/体脂趋势分析（变化量、均值、极值、目标预估） |

#### 饮食记录
| 工具名 | 说明 |
|--------|------|
| `fitness_meal_record` | 记录用餐，自动扣减食材库存并计算营养 |
| `fitness_meal_history` | 查询用餐历史 |
| `fitness_meal_daily_summary` | 每日饮食摘要，对比 TDEE |

#### 菜单规划
| 工具名 | 说明 |
|--------|------|
| `fitness_menu_recommend` | 汇总成员状况/历史/偏好/库存，生成推荐上下文供 AI 推理 |
| `fitness_menu_save` | 保存周菜单计划 |
| `fitness_menu_get_week` | 查看本周菜单 |

#### 购物清单
| 工具名 | 说明 |
|--------|------|
| `fitness_shopping_generate` | 根据周菜单生成购物清单，参考历史采购量 |
| `fitness_shopping_update` | 更新购物项（实际数量、价格、门店） |
| `fitness_shopping_complete` | 完成购物，批量入库并记录采购历史 |

#### 采购记录
| 工具名 | 说明 |
|--------|------|
| `fitness_purchase_record` | 记录单次采购，自动入库补货 |
| `fitness_purchase_history` | 查询采购历史 |

#### 运动管理
| 工具名 | 说明 |
|--------|------|
| `fitness_exercise_plan` | 创建运动计划（时长、强度、时段） |
| `fitness_exercise_record` | 记录运动完成情况，自动标记对应计划 |
| `fitness_exercise_history` | 查询运动记录和计划 |

#### 成本统计
| 工具名 | 说明 |
|--------|------|
| `fitness_cost_summary` | 按日/周/月统计食材采购、餐均成本、运动时间、净热量 |

### 斜杠命令

| 命令 | 说明 |
|------|------|
| `/fitness_report` | 综合健康报告：体重趋势、饮食分析、运动统计、成本摘要 |
| `/weekly_plan` | 本周菜单和运动计划概览 |

### CLI 命令

```bash
# 从 JSON 文件批量导入数据
openclaw cli fitness-import --type recipes --file ./my-recipes.json
openclaw cli fitness-import --type pantry --file ./pantry-data.json
openclaw cli fitness-import --type members --file ./family.json
```

支持的数据类型：`recipes`、`pantry`/`pantry_items`、`members`/`family_members`、`exercises`、`meals`

### 智能上下文注入

配置 `defaultMemberId` 后，每次对话时自动注入：

- 当前体重 → 目标体重的进度
- 今日各餐热量摄入及剩余额度
- 即将过期的食材预警
- 低库存食材提醒

## 预置菜谱

插件首次启动时自动导入 10 道低脂中式菜谱：

| 菜名 | 热量 | 特点 |
|------|------|------|
| 清蒸鸡胸肉 | 165kcal | 高蛋白低脂 |
| 西兰花炒虾仁 | 180kcal | 2人份 |
| 番茄鸡蛋汤 | 95kcal | 2人份 |
| 凉拌黄瓜 | 45kcal | 零脂肪 |
| 糙米饭配牛肉西兰花 | 420kcal | 均衡营养 |
| 三文鱼牛油果沙拉 | 350kcal | 富含 Omega-3 |
| 紫薯燕麦粥 | 250kcal | 低 GI 早餐 |
| 清炒时蔬 | 60kcal | 高纤维 |
| 豆腐蘑菇汤 | 85kcal | 植物蛋白 |
| 鸡胸肉蔬菜卷饼 | 280kcal | 便携午餐 |

可通过编辑 `data/seed-recipes.json` 自定义预置菜谱，或通过 CLI 导入更多菜谱。

## 数据存储

使用 LanceDB 作为本地存储，共 14 张数据表：

`family_members` · `pantry_items` · `pantry_transactions` · `meals` · `recipes` · `weekly_menus` · `shopping_lists` · `shopping_list_items` · `purchase_history` · `exercises` · `exercise_plans` · `body_measurements` · `food_preferences` · `daily_water_intake`

所有数据存储在本地，不会上传到任何远端服务。
