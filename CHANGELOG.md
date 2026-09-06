# 更新日志 (CHANGELOG)

本文档记录 **OpenLearn 班级与学生管理增强插件 (`@ext/class-manager`)** 的版本更新历程与变更详情。

---

## [0.3.11] - 2026-09-06

### 🐛 修复 (Bug Fixes)

- **引擎版本纠正**：`engines.openlearn` 统一为 `>=0.2.5`（宿主当前为 0.3.x 版本线，官方推荐向前兼容声明）；上版误写的 `>=5.1.0` 会被 SemVer 判定不兼容而拒载，已回滚。
- **补齐 manifest `main` 字段**：新规范中 `main` 为必填字段（入口文件名），补为 `"index.js"`。

### ⚡ 增强 (Enhancements)

- **白板挂件迁移到宿主命令**：`class_mgr.draw_widget` 改用 `whiteboard.query` / `whiteboard.draw` / `whiteboard.update` 命令，不再直写宿主 `whiteboard_elements` 表。
- **班级创建迁移到宿主命令**：`class_mgr.class_create` 改用 `class.create` 命令，宿主生成 `classId`；插件增强表仍保存 `code`/`grade` 等扩展字段。
- **学生导入迁移到宿主命令**：`class_mgr.student_batch_import` 改用 `student.list` 查重 + `student.create` / `class.add_student` 命令，移除宿主 `students` / `class_students` 表直写。
- **全量同步迁移到宿主命令**：`syncAllToHost` 改用 `class.list` / `student.list` 比对 + `class.create` / `student.create` / `class.add_student` 幂等补建，并级联更新插件表引用；不再直写宿主表。

## [0.3.10] - 2026-09-06

### 🐛 修复 (Bug Fixes)

- **学生查重串号**：`student_batch_import` 去重改为仅按 `student_number` 匹配，重名学生不再互相覆盖；插件表改为 UPSERT，重导入时保留已有积分与分组。
- **事务内异步 I/O 移出**：`student_batch_update_points` 将事件发布与宿主积分账本写入移出事务，消除并发交错与“外层回滚连带内层”风险。
- **出勤率语义修正**：无考勤记录时 `attendanceRate` 返回 `null`（不再显示 100%），前端显示「—」。

### ⚡ 增强 (Enhancements)

- **均匀洗牌**：分组/点名改用 Fisher-Yates 洗牌，替代有偏的 `sort(() => Math.random() - 0.5)`。
- **tags 解析保护**：脏数据降级为空数组，避免花名册查询整体失败。

### 🛡️ 安全与兼容性 (Security & Compatibility)

- **引擎版本规范化**：`engines.openlearn` 统一为 `>=0.2.5`（官方推荐向前兼容声明，宿主当前为 0.3.x 版本线）。
- **清理死代码与死依赖**：移除未使用的 `uuid` 依赖与 `class_mgr_open_floating` 死事件监听。
- **AI 工具 schema 补全**：`class_mgr-ai-batch-points` 的 `studentIds` 数组参数补齐 `items` 类型。

## [0.3.9] - 2026-08-29

### 🛡️ 安全与健壮性修复 (Security & Robustness)

- **学生端事件按身份过滤**：`student.view` 仅处理属于当前学生本人的点名与积分事件，修复「任何学生被点名/加分，所有学生端都收到个人化提醒」的错误；移除硬编码假数据（初始积分、100% 全勤、连续 12 堂签到），改为中性占位。
- **修复排课数据污染**：移除 `syncAllToHost` 中「全部课节 × 全部班级」笛卡尔积生成 `schedules` 的逻辑（每次激活产生海量垃圾排课）；白板/专注力对学生识别由 `class_students` 关联保证。
- **白板挂件去重**：`class_mgr.draw_widget` 按 `lessonId + teacherWidgetId` 去重，重复点击更新坐标/尺寸而非堆叠新卡片。
- **悬浮加分挂件角色守卫**：仅教师角色注入右下角悬浮按钮，学生端不再出现教师操作入口；widget 别名从 4 个收敛为 2 个，避免重复挂件。

### 🐛 修复 (Bug Fixes)

- **补齐输入校验**：考勤 `status` 枚举校验、`delta` 限定 -100~100 整数、`classId`/班级名/学生姓名必填、批量/导入数量上限、点名 `count` 钳制 ≥1。
- **消除关键路径静默吞错**：同步、索引创建、事务回滚、积分账本同步等 10 处改为 `ctx.log` 可见日志。
- **事务重入保护**：宿主已开启事务或插件嵌套时直接透传执行，避免共享连接嵌套 BEGIN 崩溃。
- **deactivate 资源清理**：注销全部已注册命令 Handler 与 AI Action。

### ✨ 增强 (Enhancements)

- **宿主积分账本集成（可选）**：通过 `IPointsLedgerService` / `IPointsDimensionRegistry` 尽力同步加分至宿主账本（含审计与维度统计），宿主未提供时自动降级为插件内积分。
- **`gender_balance` 分组策略落地**：按性别分桶洗牌后交错轮转分配，保证各组性别均衡；策略参数非法时报错。
- **教师端新增「添加学生」表单**：替换原「导入演示学生花名册」假数据按钮，支持学号(可选)+姓名录入。
- **使用 SDK 官方 Token**：`IDatabaseToken` / `IPointsLedgerServiceToken` / `IPointsDimensionRegistryToken` 替换手写 Token hack。

### ⚠️ 已知限制

- 白板元素仍为直写宿主 `whiteboard_elements` 表（已补 `whiteboard:write` 权限申报）；待宿主 `whiteboard.draw` 命令契约验证后再迁移。
- 学生端初始积分显示 0，待下一次 `points_changed` 事件刷新。

---

## [0.3.8] - 2026-08-28

### 🐛 修复 (Bug Fixes)
- **解决 Worker 线程 DataCloneError 崩溃**：修复 `class_mgr.draw_widget` 中调用主线程命令时产生的 `DOMException [DataCloneError]: #<Promise> could not be cloned` 异常，改为直接原子写入 `whiteboard_elements` 表并返回纯 JSON 响应。
- **白板画布坐标与尺寸精准投射**：自动为白板卡片注入 `x: 120, y: 100, width: 440, height: 520, page: 0` 布局参数，确保元素投射在白板视野中心。
- **白板卡片流式自适应容器**：优化 `ClassDashboardWidget` 内部样式为响应式流式布局，去除冗余固定边框，与宿主白板外壳无缝契合。

---

## [0.3.7] - 2026-08-28

### ⚡ 增强 (Enhancements)
- **白板画布更新事件广播**：白板小挂件部署后自动发布 `whiteboard.element_updated` 事件，驱动白板画布即时刷新与拉取。
- **双通道加分支持**：白板画布卡片与常驻悬浮加分气泡联动触发。

---

## [0.3.6] - 2026-08-28

### 🐛 修复 (Bug Fixes)
- **彻底清除浏览器裸模块导入 (Bare Specifier)**：重构前端模块中 `React` 与 `ReactDOM` 的引用方式，采用 `window.HostSharedDeps` 共享依赖与 TypeScript `type-only import`，彻底解决浏览器端动态 `import()` 插件时报 `TypeError: Failed to resolve module specifier "react"` 导致的激活阻塞问题。

---

## [0.3.5] - 2026-08-28

### ⚡ 增强 (Enhancements)
- **白板工具架与悬浮挂件实时联动**：点击白板工具架【课堂加分与点名】时，后端广播 `class_mgr.open_floating_widget` 事件，前端挂件即刻在白板上方自动弹开展开。
- **右下角常驻悬浮胶囊**：常驻提供「⚡ 课堂加分」悬浮入口，随时呼出加分与点名面板。

---

## [0.3.4] - 2026-08-28

### 🐛 修复 (Bug Fixes)
- **解决 PayloadValidationError 缺失 lessonId**：新增 `class_mgr.draw_widget` 代理 Handler，自动探测并补齐当前活跃课节上下文，避免直接调用 `whiteboard.draw` 缺少 `lessonId` 的校验拦截。

---

## [0.3.3] - 2026-08-28

### ⚡ 增强 (Enhancements)
- **全量双向历史数据补偿机制 (`syncAllToHost`)**：插件启动时自动将插件数据同步至宿主系统的 `classes`, `students`, `class_students`, `schedules` 表，确保宿主白板专注力监控 100% 识别学生。
- **多别名扩展点注册**：在前端为 `teacher.dashboard.widget` 注册多组别名兼容各种寻址策略。

---

## [0.3.2] - 2026-08-28

### ⚡ 增强 (Enhancements)
- **白板课堂积分与小组 PK 互动**：支持白板端学生单人加减分、多选批量奖惩、全组 PK 一键加分与随堂点名。
- **教师侧边栏管理页交互升级**：增加学生多选框、批量奖惩操作条及一键「🔄 同步白板数据」按钮。

---

## [0.3.1] - 2026-08-28

### 🐛 修复 (Bug Fixes)
- **双源融合查询**：班级与学生管理打通宿主原生表与插件私有表，支持直接管理原生系统班级。

---

## [0.3.0] - 2026-08-27

### ✨ 新增 (Features)
- **全套班级花名册管理**：支持班级创建、花名册批量导入、智能与随机分组。
- **课堂点名考勤**：支持随堂随机点名抽签、考勤状态录入与学情汇总统计。
- **AI Agent 工具赋能**：内置 `class_mgr-ai-rollcall`、`class_mgr-ai-group`、`class_mgr-ai-attendance-summary` 等 AI Action。
