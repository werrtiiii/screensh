# ScreenSh UI 舒适度优化实施计划

> **For agentic workers:** 使用 superpowers:executing-plans，按下列任务顺序执行并验证。

**Goal:** 在现有桌面工具风格上提高简洁度、视觉层级和动效舒适度。

**Architecture:** 继续由 renderer/ui.css 统一管理视觉与动效；设置复用 ui.js 的分类面板，业务处理与弹窗键盘控制保持原有契约。

**Tech Stack:** 原生 HTML、CSS、JavaScript，Electron。

**Spec:** 根目录 DESIGN.md、UX-CONTRACT.md。

## 实施与验证

- [x] 在现有 Electron 视觉测试中验证左侧分类布局、键盘上下切换、最小窗口边界和减少动画；先确认新增检查失败。
- [x] 在 ui.css 调整浅深色语义变量、留白、输入框和按钮；首页去除多余外框；设置采用 132px 左侧导航与自适应内容区。
- [x] 为设置分类补充内容标题与垂直键盘操作；统一短距离淡入，移除缩放和齿轮旋转，减少动画模式全部停用。
- [x] 检查首页、房间、常规/语音/共享设置截图，运行交互、视觉和完整 UI 回归。
- [x] 更新 DESIGN.md 和 UX-CONTRACT.md，并审查最终变更。

不新增 UI 库、字体下载或动画依赖。保持浅深色主题、960×640 最小窗口、焦点契约、筛选和设置保存方式。

## 验证记录

Electron：smoke-ui-design、smoke-ui-interactions、smoke-ui、smoke-easytier-settings 均通过。已实际查看浅色首页、常规/语音设置、深色共享设置和房间截图。独立审查未发现具体回归。

单元测试：`node --test --test-concurrency=1 tests/*.test.js`：300 通过、1 跳过；并行首轮媒体 UDP 时序测试超时，串行完整复跑通过。

静态审查已执行严格模式，未声称全量通过：保留了既有 80 项原生 JavaScript 事件绑定识别提示、14 项旧表单验证方式提示、2 项外部 CSS textarea 识别提示，以及 style.css WebKit 回退处未识别 ui.css 标准滚动条属性的提示。控件行为由真实 Electron 回归验证，本次不扩大到重写既有表单。
