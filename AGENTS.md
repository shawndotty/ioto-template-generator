# IOTO Template Generator（Obsidian 社区插件）

## 项目概览

- 目标：Obsidian Community Plugin（TypeScript → esbuild 打包后的 JavaScript）。
- 插件 ID：`ioto-template-generator`（见 `manifest.json`，本地开发时应与插件文件夹名一致）。
- 入口：`src/main.ts`（见 `esbuild.config.mjs` 的 `entryPoints`）。
- Obsidian 加载入口：根目录的 `main.js`（由 esbuild 输出，`manifest.json` 的 `main` 指向它）。
- 本地安装/发布所需文件：`main.js`、`manifest.json`、`styles.css`（若有）、`versions.json`（用于社区目录校验/提交）。

## 环境与工具链

- Node.js：CI 使用 Node 20.x / 22.x；本地建议使用 Node 20+。
- 包管理器：npm（仓库包含 `package-lock.json`；CI 用 `npm ci`）。
- TypeScript：构建前会执行 `tsc -noEmit -skipLibCheck` 做类型检查。
- 打包器：esbuild（输出 CommonJS 到根目录 `main.js`；开发模式使用 inline sourcemap）。
- ESLint：使用仓库内的 `eslint.config.mts`，命令为 `npm run lint`。

## 常用命令（以 `package.json` 为准）

### 安装依赖

```bash
npm ci
```

（本地也可用 `npm install`。）

### 开发（watch）

```bash
npm run dev
```

- 作用：启动 esbuild watch，持续重建根目录 `main.js`（默认带 inline sourcemap，便于在 Obsidian 中调试）。

### 生产构建

```bash
npm run build
```

- 作用：先类型检查，再用 esbuild 以 production 参数构建（`main.js` 会 minify，默认不生成 sourcemap）。

### 代码规范

```bash
npm run lint
```

## 目录结构（与当前仓库一致）

```
src/
  main.ts                # 插件生命周期：loadSettings、registerView、ribbon、设置页
  settings.ts            # 设置项定义 + Tabbed 设置页渲染
  views/
    GeneratorView.ts     # 主视图（GENERATOR_VIEW_TYPE）
  processors/
    ScriptEngine.ts      # 脚本/模板生成相关逻辑
  modals/                # 各类弹窗（导入、预览、编辑等）
  services/              # 与其他插件/Obsidian 能力交互的服务层
  models/                # 常量、选项配置
  lang/                  # 多语言（helpers + locale）
  ui/                    # 通用 UI（TabbedSettings、文件/文件夹选择器等）
  types/                 # 类型定义
```

补充约定：

- `tsconfig.json` 里设置了 `baseUrl: "src"`，因此代码中存在 `import ... from "views/..."` 这类绝对导入；新增文件/移动目录时需要保持这一约定一致。
- `main.js` 是构建产物；不要把 `node_modules/`、`main.js` 等生成文件加入版本控制。

## 关键模块与集成点

### 视图与 UI

- 视图类型常量：`GENERATOR_VIEW_TYPE = "ioto-template-generator-view"`（`src/models/constants.ts`）。
- 插件入口在 `onload()` 中注册视图并添加 ribbon 图标；用户点击后会打开/聚焦该视图（`src/main.ts`）。
- 设置页：`src/settings.ts`，使用 `ui/tabbed-settings.ts` 提供的 Tab UI。

### 外部插件集成（可选）

- IOTO Settings：通过 `app.plugins.plugins["ioto-settings"]` 读取 IOTO 相关配置。
    - `src/services/ioto-settings-services.ts` 提供了可用性检测与读取封装；尽量复用该服务，避免直接访问导致未安装时崩溃。
- Templater：通过 `app.plugins.plugins["templater-obsidian"]` 修改其配置并动态注册模板命令/快捷键。
    - 入口服务：`src/services/templater-services.ts`。
    - 典型使用：`src/modals/ScriptPreviewModal.ts` 在保存模板后尝试把模板加入 Templater hotkeys 并写入 Obsidian 热键。

## 测试与本地验证

- 本仓库目前没有自动化测试；CI 会跑 `npm run build` 和 `npm run lint`。
- 手动安装/调试：
    1. 运行 `npm run dev` 或 `npm run build` 生成根目录 `main.js`
    2. 复制 `main.js`、`manifest.json`、`styles.css`（若有）到：
        ```
        <Vault>/.obsidian/plugins/ioto-template-generator/
        ```
    3. 重新加载 Obsidian 并在 **Settings → Community plugins** 启用插件

## 版本号与发布

- `package.json` 的版本号是主版本源；执行 `npm version patch|minor|major` 会触发 `version-bump.mjs`：
    - 同步更新 `manifest.json` 的 `version`
    - 按需更新 `versions.json`（插件版本 → `minAppVersion`）
    - 并 `git add manifest.json versions.json`
- 发布前检查：
    - `manifest.json` 的 `version` 与 `package.json` 一致
    - `versions.json` 包含当前版本号对应的 `minAppVersion`
    - Release 资产通常包含 `main.js`、`manifest.json`、`styles.css`（若有）
