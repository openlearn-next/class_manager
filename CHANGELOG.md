# 更新日志 (CHANGELOG)

本文档记录 **OpenLearn 班级与学生管理增强插件 (`@ext/class-manager`)** 的版本更新历程与变更详情。

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
