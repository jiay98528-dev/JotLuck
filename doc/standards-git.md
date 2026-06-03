# MarkLuck Git 协作规范

> 版本：v1.0 | 日期：2026-06-03
> 关联文档：`tool.md`（开发工作流）、`PRODUCT.md`（"精确"）

---

## 一、Commit 信息规范 (Conventional Commits)

### 格式

```
<type>(<scope>): <subject>

[body]

[footer]
```

### Type

| Type       | 用途                                |
| ---------- | ----------------------------------- |
| `feat`     | 新功能                              |
| `fix`      | Bug 修复                            |
| `docs`     | 文档变更                            |
| `style`    | 代码格式（空格/分号等，不影响逻辑） |
| `refactor` | 重构（无功能变更，无 Bug 修复）     |
| `perf`     | 性能优化                            |
| `test`     | 添加或修改测试                      |
| `chore`    | 维护任务（依赖、配置、构建）        |
| `ci`       | CI/CD 变更                          |
| `revert`   | 回滚之前的提交                      |

### Scope（MarkLuck 专用）

| Scope      | 范围                                               |
| ---------- | -------------------------------------------------- |
| `editor`   | CodeMirror 编辑器、语法块系统、工具栏              |
| `renderer` | Markdown 渲染管线（marked/DOMPurify/highlight.js） |
| `search`   | 搜索引擎、索引                                     |
| `export`   | 文档导出（docx/xlsx/pdf/txt/html）                 |
| `share`    | 分享功能                                           |
| `sidebar`  | 文件树、导航树                                     |
| `tauri`    | Tauri 后端、Rust 代码                              |
| `ui`       | 主题、设计系统、CSS                                |
| `types`    | TypeScript 类型定义                                |
| `config`   | 项目配置（vite/tsconfig/eslint/tauri.conf）        |
| `docs`     | 文档                                               |
| `deps`     | 依赖更新                                           |

### Subject 规则

- 使用祈使语气（"添加" 而非 "添加了" 或 "添加的"）
- 首字母小写
- 不以句号结尾
- ≤ 72 字符
- 中英文均可

### 示例

```
feat(editor): add Tab toggle between source and render mode for syntax blocks

fix(search): handle empty index returning all results instead of none

docs(standards): add TypeScript and Vue coding conventions

refactor(renderer): extract wiki-link parser into separate extension

style(ui): enforce OKLCH color usage across all components

chore(deps): bump marked to v15.0.0

ci: add Playwright E2E cross-browser matrix to GitHub Actions
```

---

## 二、分支策略

### 分支类型

| 分支     | 用途                 | 命名                |
| -------- | -------------------- | ------------------- |
| `main`   | 生产就绪代码，受保护 | `main`              |
| 功能分支 | 新功能开发           | `feat/<name>`       |
| 修复分支 | Bug 修复             | `fix/<description>` |
| 文档分支 | 文档变更             | `docs/<topic>`      |
| 重构分支 | 代码重构             | `refactor/<scope>`  |

### 命名规则

- 全小写
- 连字符分隔单词
- 简洁描述意图

```
✅ feat/wiki-link-backlinks
✅ fix/file-encoding-windows-path
✅ docs/api-reference
❌ Feature_WikiLink         (大小写混乱)
❌ fix-bug-2026-06-03       (日期不是描述)
❌ mybranch                 (不描述意图)
```

---

## 三、工作流

```
1. git checkout main
2. git pull origin main
3. git checkout -b feat/<name>
4. [编码 + 提交（遵循 Conventional Commits）]
5. [运行 L1 检查：vue-tsc + eslint + vitest + cargo test]
6. git push origin feat/<name>
7. [创建 PR（如适用）]
8. [代码审查]
9. [Squash merge 到 main]
10. git branch -d feat/<name>
```

### 提交粒度

- 一个提交做一件事
- 不混合功能变更和格式化变更
- WIP 提交在 Push 前 squash

---

## 四、PR 描述模板

```markdown
## 概要

<!-- 简要描述变更内容 -->

## 变更清单

-
-

## 测试

- [ ] L1 通过（vue-tsc, eslint, vitest, cargo test）
- [ ] L2 通过（Playwright E2E — 如有 UI 变更）
- [ ] 手动测试通过（描述测试场景）

## 截图（如有 UI 变更）

<!-- 前后对比截图 -->

## 关联

- Closes #<issue>
```

---

## 五、Git Hooks

### pre-commit（lint-staged）

```json
// package.json
{
  "lint-staged": {
    "src/**/*.{ts,vue}": ["eslint --fix", "prettier --write"],
    "src/**/*.css": ["stylelint --fix"],
    "src-tauri/src/**/*.rs": ["rustfmt --edition 2021"]
  }
}
```

### commit-msg（commitlint）

```javascript
// commitlint.config.js
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'editor',
        'renderer',
        'search',
        'export',
        'share',
        'sidebar',
        'tauri',
        'ui',
        'types',
        'config',
        'docs',
        'deps',
      ],
    ],
  },
};
```

### pre-push

```bash
npx vue-tsc --noEmit && npx vitest run && cargo test
```

---

## 六、禁止事项

| 禁止                                     | 说明                                        |
| ---------------------------------------- | ------------------------------------------- |
| `git push --force` 到 `main`             | 绝对禁止                                    |
| 直接提交到 `main`                        | 功能开发必须走分支                          |
| 一个提交包含无关变更                     | 格式修改和功能修改分开提交                  |
| 提交 `node_modules/`、`dist/`、`target/` | 由 `.gitignore` 阻止                        |
| 提交 `.env` 文件                         | 由 `.gitignore` 阻止                        |
| 提交 > 1MB 的二进制文件                  | 使用 Git LFS 或外部存储                     |
| 提交密钥/Token/密码                      | 立即轮换密钥 + `git filter-branch` 清理历史 |

---

## 七、.gitignore 参考

```gitignore
# 依赖
node_modules/
target/

# 构建产物
dist/
build/

# 环境
.env
.env.local
.env.*.local

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# 日志
*.log
npm-debug.log*
```
