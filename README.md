# OpenLearn 班级与学生管理增强插件 (`@openlearn/class-manager`)

为 **OpenLearn-Next** 提供全套班级花名册管理、动态分组、课堂随机点名、考勤签到与学生积分激励能力。

---

## 🌟 核心特性

- **班级与花名册管理**：支持班级创建、花名册批量导入/导出、学生标签画像。
- **智能与随机分组**：一键生成教学协作小组，支持按人数均分与标签均衡。
- **课堂点名与签到**：
  - 白板可拖拽点名小挂件，支持抽奖动效随机抽选。
  - 课堂出勤状态（出勤/迟到/请假/旷课）快捷记录与统计。
- **学生积分激励**：课堂表现加减分（积极发言 +2、答题正确 +5 等），学生端自主查看。
- **AI Agent 工具赋能**：内置 3 个 AI Actions，支持 AI 助教通过自然语言执行点名、自动分组与学情总结。
- **多端 UI 扩展**：深度适配 `teacher.tab`、`teacher.panel`、`classroom.tool`、`teacher.dashboard.widget` 与 `student.view`。

---

## 📦 安装与部署

### 1. 本地构建
```bash
npm install
npm run build
```

构建后将在 `dist/` 目录生成插件压缩包：
- `dist/openlearn-plugin-class-manager.zip`

### 2. 在 OpenLearn 后台上传
1. 打开 OpenLearn 管理后台 → **系统设置** → **插件中心**。
2. 点击 **上传插件**，选择 `dist/openlearn-plugin-class-manager.zip`。
3. 开启并激活插件。
4. 进入课堂白板或教师端侧边栏，即可看到「班级管理」标签页与「课堂点名」工具。

---

## 🛠️ 命令与 AI Agent 工具

### 命令总线 (Commands)
- `class_mgr.class_create`: 创建新班级
- `class_mgr.class_list`: 查询班级列表与学生统计
- `class_mgr.student_batch_import`: 批量导入学生花名册
- `class_mgr.student_list`: 获取指定班级学生列表与积分
- `class_mgr.student_update_points`: 调整学生积分（+ / -）
- `class_mgr.group_generate`: 智能生成分组
- `class_mgr.group_list`: 查询分组列表
- `class_mgr.rollcall_pick`: 课堂随机抽选学生
- `class_mgr.attendance_record`: 录入考勤状态
- `class_mgr.attendance_list`: 查询课堂考勤记录
- `class_mgr.class_summary`: 获取班级学情与活跃度综合报表

### AI Agent Actions
- `class_mgr-ai-rollcall`：AI 智能课堂随机抽问/点名
- `class_mgr-ai-group`：AI 智能分组算法
- `class_mgr-ai-attendance-summary`：AI 学情与考勤综合总结

---

# OpenLearn 班级与学生管理增强插件 (`@ext/class-manager`)
...
## 📄 架构声明 (Manifest)
- **ID**: `@ext/class-manager`
- **版本**: `0.3.8`
- **适配引擎**: `openlearn: ">=0.2.0"`
- **权限需求**: `lesson:read`, `lesson:write`, `management:read`, `management:write`
