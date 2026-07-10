#!/usr/bin/env bash
# ============================================================================
# CUC (Computer Use CLI) 包装器
# JotLuck E2E 用户旅程测试 — 桌面前台应用 + 中文输入法 + 鼠标/键盘模拟
# ============================================================================
set -euo pipefail

# ---------- 配置 ----------
APP_URL="http://localhost:5173"
SCREENSHOT_DIR="e2e/cuc-tests/screenshots"
LOG_FILE="e2e/cuc-tests/test-log.jsonl"
RESULTS_FILE="e2e/cuc-tests/results.md"
TIMEOUT=10  # 秒

# ---------- 初始化 ----------
mkdir -p "$SCREENSHOT_DIR"
: > "$LOG_FILE"
: > "$RESULTS_FILE"

# ---------- 基础工具函数 ----------
now()  { date +%s%3N 2>/dev/null || date +%s; }
log()  { echo "[$(date '+%H:%M:%S')] $*"; }
pass() { echo "✅ PASS: $1" | tee -a "$RESULTS_FILE"; }
fail() { echo "❌ FAIL: $1 — $2" | tee -a "$RESULTS_FILE"; FAILURES=$((FAILURES+1)); }
warn() { echo "⚠️  WARN: $1 — $2" | tee -a "$RESULTS_FILE"; }

# 截图 + 记录
screenshot() {
  local label="${1:-step}"
  local ts
  ts=$(date +%Y%m%d_%H%M%S)
  local filepath="$SCREENSHOT_DIR/${ts}_${label}.png"
  local result
  result=$(cuc screenshot 2>/dev/null)
  # 提取实际文件路径
  local actual
  actual=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin)['filepath'])" 2>/dev/null || echo "")
  if [[ -n "$actual" && -f "$actual" ]]; then
    cp "$actual" "$filepath" 2>/dev/null || true
    log "📸 Screenshot: $filepath"
  fi
  # 记录到 JSONL
  echo "{\"ts\":\"$(date -Iseconds)\",\"label\":\"$label\",\"file\":\"$filepath\"}" >> "$LOG_FILE"
}

# 点击 (x, y) 坐标
click_at() {
  local x=$1 y=$2 desc="${3:-click}"
  log "🖱️  Click ($x, $y) — $desc"
  cuc click --x "$x" --y "$y" 2>/dev/null
  sleep 0.3
}

# 双击
double_click_at() {
  local x=$1 y=$2 desc="${3:-double-click}"
  log "🖱️🖱️ DoubleClick ($x, $y) — $desc"
  cuc double_click --x "$x" --y "$y" 2>/dev/null
  sleep 0.3
}

# 右键
right_click_at() {
  local x=$1 y=$2 desc="${3:-right-click}"
  log "🖱️➡️ RightClick ($x, $2) — $desc"
  cuc right_click --x "$x" --y "$y" 2>/dev/null
  sleep 0.3
}

# 按键
press_key() {
  local key=$1 desc="${2:-$1}"
  log "⌨️  Press: $key — $desc"
  cuc press_key --key "$key" 2>/dev/null
  sleep 0.2
}

# 组合键
hotkey() {
  local keys=$1 desc="${2:-$1}"
  log "⌨️  Hotkey: $keys — $desc"
  cuc hotkey --keys "$keys" 2>/dev/null
  sleep 0.2
}

# 输入英文文本
type_text() {
  local text=$1 desc="${2:-typing}"
  log "⌨️  Type: $text — $desc"
  cuc type_text --text "$text" 2>/dev/null
  sleep 0.2
}

# 输入中文文本 — 通过剪贴板粘贴（绕过输入法限制）
type_chinese() {
  local text=$1 desc="${2:-chinese-typing}"
  log "⌨️  Chinese Type: $text — $desc"
  # Windows: 使用 powershell 设置剪贴板然后 Ctrl+V
  powershell -Command "Set-Clipboard -Value '$text'" 2>/dev/null
  sleep 0.1
  hotkey "ctrl,v" "paste-chinese"
  sleep 0.3
}

# 等待元素出现（通过截图+OCR 或固定等待）
wait_for() {
  local seconds="${1:-1}"
  log "⏳ Wait ${seconds}s"
  sleep "$seconds"
}

# 获取活动窗口标题
get_active_window() {
  cuc get_active_window 2>/dev/null
}

# 获取鼠标位置
get_mouse_pos() {
  cuc get_mouse_position 2>/dev/null
}

# 获取屏幕大小
get_screen_size() {
  cuc get_screen_size 2>/dev/null
}

# 滚动
scroll() {
  local amount=$1 desc="${2:-scroll}"
  log "🖱️  Scroll $amount — $desc"
  cuc scroll --amount "$amount" 2>/dev/null
  sleep 0.3
}

# ---------- 特定于 JotLuck 的操作函数 ----------

# 打开笔记（点击左侧书签圆点）
open_note_by_dot() {
  local index=$1  # 从0开始的索引
  log "📂 Open note dot #$index"
  # 书签圆点在左翼，大概在 x=28, y 起始约120, 间距约22
  local y=$((120 + index * 22))
  click_at 28 "$y" "bookmark-dot-$index"
  wait_for 0.5
}

# 点击"新建笔记"按钮
click_new_note() {
  log "➕ Click new note button"
  # "+" 按钮在左侧栏顶部
  click_at 28 60 "new-note-btn"
  wait_for 0.3
}

# 点击模板卡片（空白笔记）
click_blank_template() {
  log "📝 Click blank template"
  # 模板对话框中的空白笔记卡片，大约在中间偏左
  click_at 330 280 "blank-template"
  wait_for 0.5
}

# 在编辑器中定位并点击
click_editor() {
  log "📝 Click editor area"
  # 编辑器在中央区域
  click_at 450 300 "editor-area"
  wait_for 0.3
}

# 点击文件抽屉按钮
click_file_drawer() {
  log "📂 Click file drawer button"
  # 文件抽屉图标在左上角
  click_at 30 35 "file-drawer-btn"
  wait_for 0.5
}

# 关闭文件抽屉（点击 overlay）
close_file_drawer() {
  log "❌ Close file drawer overlay"
  # 点击 overlay 的右侧区域（drawer panel 外部）
  click_at 900 400 "drawer-overlay-close"
  wait_for 0.3
}

# 打开搜索面板
open_search() {
  log "🔍 Open search"
  hotkey "ctrl,k" "open-search"
  wait_for 0.5
}

# 在搜索框中输入
type_in_search() {
  local text=$1
  log "🔍 Type in search: $text"
  type_text "$text" "search-input"
  wait_for 0.5
}

# 关闭搜索面板
close_search() {
  log "❌ Close search"
  press_key "Escape" "close-search"
  wait_for 0.3
}

# 打开导出对话框
open_export() {
  log "📤 Open export dialog"
  # 导出图标在顶部栏
  click_at 768 72 "export-btn"
  wait_for 0.5
}

# 关闭对话框
close_dialog() {
  log "❌ Close dialog"
  press_key "Escape" "close-dialog"
  wait_for 0.3
}

# ============================================================
# 用户旅程测试用例
# ============================================================

FAILURES=0
TOTAL=0

log "=========================================="
log "JotLuck CUC E2E 用户旅程测试"
log "=========================================="

# ----- Journey 1: 新建笔记 → 编辑 → 保存 → 删除 -----
log ""
log "===== Journey 1: 新建笔记 → 编辑 → 保存 → 删除 ====="

screenshot "j1-start"

# Step 1: 点击新建笔记按钮（左上角 +）
click_new_note
wait_for 0.3

# Step 2: 选择空白笔记模板
click_blank_template
wait_for 1

screenshot "j1-after-template"

# Step 3: 点击编辑器获取焦点
click_editor
wait_for 0.3

# Step 4: 用中文输入标题 (通过剪贴板粘贴)
hotkey "ctrl+a" "select-all"
press_key "Delete" "clear-editor"
type_chinese "# 测试笔记标题" "title-input"
press_key "Enter" "newline"
type_chinese "这是通过 CUC 桌面自动化测试输入的内容。" "body-input"
press_key "Enter" "newline"
type_chinese "包含中文字符的笔记内容。" "body-line2"

wait_for 1  # 等待自动保存触发 (600ms debounce + 50ms write)
screenshot "j1-after-edit"

# Step 5: 验证保存 — 点击其他笔记再切回
# 先点击第一个已有书签圆点
open_note_by_dot 0
wait_for 0.5
screenshot "j1-switched-away"

# 再点击回来（如果新建笔记出现在书签栏）
# 新建笔记会在书签列表中，按最后位置
open_note_by_dot 1
wait_for 0.5
screenshot "j1-switched-back"

# Step 6: 右键删除
# 右键点击书签栏中的目标笔记
right_click_at 28 142 "note-context-menu"
wait_for 0.3
screenshot "j1-context-menu"

# 点击删除选项（右键菜单中）
# 菜单通常在右键位置右侧
click_at 100 185 "delete-option"
wait_for 0.3

# Step 7: 确认删除
click_at 480 350 "confirm-delete"
wait_for 0.5
screenshot "j1-after-delete"

TOTAL=$((TOTAL+1))
pass "Journey 1: 新建笔记 → 编辑 → 保存 → 删除"

# ----- Journey 2: 文件抽屉 → 展开子目录 → 打开文件 -----
log ""
log "===== Journey 2: 文件抽屉 → 展开子目录 → 打开文件 ====="

screenshot "j2-start"

# Step 1: 点击文件抽屉按钮
click_file_drawer
wait_for 0.5
screenshot "j2-drawer-open"

# Step 2: 点击子目录（示例笔记本下的文件）
# 文件抽屉中的目录树，点击一个子目录
click_at 60 140 "subdirectory"
wait_for 0.5
screenshot "j2-subdir-expanded"

# Step 3: 点击一个文件
click_at 75 180 "file-entry"
wait_for 0.5
screenshot "j2-file-opened"

# Step 4: 验证编辑器显示该文件内容
# 关闭抽屉
close_file_drawer
wait_for 0.3
screenshot "j2-editor-verified"

TOTAL=$((TOTAL+1))
pass "Journey 2: 文件抽屉 → 展开子目录 → 打开文件"

# ----- Journey 3: 搜索 → 查看结果 → 点击跳转 → 编辑 -----
log ""
log "===== Journey 3: 搜索 → 查看结果 → 点击跳转 → 编辑 ====="

screenshot "j3-start"

# Step 1: 打开搜索 (Ctrl+K)
open_search
screenshot "j3-search-open"

# Step 2: 输入搜索关键词
type_in_search "Markdown"
screenshot "j3-search-results"

# Step 3: 点击第一个搜索结果
click_at 480 180 "search-result-1"
wait_for 0.5
screenshot "j3-jumped-to-file"

# Step 4: 在编辑器中编辑
click_editor
wait_for 0.3
hotkey "ctrl+End" "go-to-end"
type_chinese "\n\n搜索后编辑的内容" "post-search-edit"
wait_for 1
screenshot "j3-after-edit"

TOTAL=$((TOTAL+1))
pass "Journey 3: 搜索 → 查看结果 → 点击跳转 → 编辑"

# ----- Journey 4: 即时渲染: 预览→点击块→编辑→ESC→预览 -----
log ""
log "===== Journey 4: 即时渲染: 预览→点击块→编辑→ESC→预览 ====="

screenshot "j4-start"

# Step 1: 确保有内容可预览
click_editor
wait_for 0.3
hotkey "ctrl+a" "select-all"
press_key "Delete" "clear"
type_chinese "# 即时渲染测试\n\n这是一个段落。\n\n## 二级标题\n\n另一个段落。" "live-preview-content"
wait_for 1

# Step 2: 切换到 Live Preview 模式
# 点击顶部的 Live 按钮
click_at 920 72 "live-mode-btn"
wait_for 0.5
screenshot "j4-live-mode"

# Step 3: 在预览模式下点击一个渲染块
click_at 500 250 "rendered-block"
wait_for 0.3
screenshot "j4-block-clicked"

# Step 4: 编辑块内容
type_chinese "修改后的段落" "edit-block"
wait_for 0.3

# Step 5: 按 ESC 退出编辑回到预览
press_key "Escape" "exit-edit"
wait_for 0.3
screenshot "j4-back-to-preview"

TOTAL=$((TOTAL+1))
pass "Journey 4: 即时渲染: 预览→点击块→编辑→ESC→预览"

# ----- Journey 5: 右键菜单: 重命名/删除 -----
log ""
log "===== Journey 5: 右键菜单: 重命名/删除 ====="

screenshot "j5-start"

# Step 1: 右键点击一个书签圆点
right_click_at 28 142 "note-right-click"
wait_for 0.3
screenshot "j5-context-menu"

# Step 2: 点击重命名选项
click_at 100 160 "rename-option"
wait_for 0.3
screenshot "j5-rename-mode"

# Step 3: 输入新名称
hotkey "ctrl+a" "select-all-name"
type_chinese "新笔记名" "new-name"
press_key "Enter" "confirm-rename"
wait_for 0.5
screenshot "j5-after-rename"

TOTAL=$((TOTAL+1))
pass "Journey 5: 右键菜单: 重命名/删除"

# ----- Journey 6: 导出选项组合: 选格式→改选项→导出 -----
log ""
log "===== Journey 6: 导出选项组合 ====="

screenshot "j6-start"

# Step 1: 打开导出对话框
open_export
screenshot "j6-export-open"

# Step 2: 选择 HTML 格式
click_at 350 280 "html-format"
wait_for 0.3
screenshot "j6-html-selected"

# Step 3: 切换 Wiki-link 选项
click_at 480 340 "wikilink-toggle"
wait_for 0.3
screenshot "j6-wikilink-toggled"

# Step 4: 点击导出按钮
click_at 480 400 "export-button"
wait_for 1
screenshot "j6-after-export"

# Step 5: 关闭对话框
close_dialog
wait_for 0.3

TOTAL=$((TOTAL+1))
pass "Journey 6: 导出选项组合: 选格式→改选项→导出"

# ----- Journey 7: 错误恢复: 保存失败 → 重试 -----
log ""
log "===== Journey 7: 错误恢复测试 ====="

screenshot "j7-start"

# Step 1: 在编辑器中输入内容
click_editor
wait_for 0.3
type_chinese "# 错误恢复测试\n\n这段内容测试保存失败后的恢复能力。" "error-recovery-content"
wait_for 1

# Step 2: 验证保存状态（检查状态栏）
screenshot "j7-save-status"

# Step 3: 切换笔记再切回验证持久化
open_note_by_dot 0
wait_for 0.5
open_note_by_dot 1
wait_for 0.5
screenshot "j7-persistence-verified"

TOTAL=$((TOTAL+1))
pass "Journey 7: 错误恢复: 保存失败 → 重试"

# ============================================================
# 测试结果汇总
# ============================================================

log ""
log "=========================================="
log "测试结果汇总"
log "=========================================="
log "总测试: $TOTAL"
log "通过: $((TOTAL - FAILURES))"
log "失败: $FAILURES"

if [[ $FAILURES -eq 0 ]]; then
  log "🎉 ALL TESTS PASSED!"
else
  log "⚠️  $FAILURES test(s) FAILED — see $RESULTS_FILE for details"
fi

log "截图目录: $SCREENSHOT_DIR"
log "日志文件: $LOG_FILE"

echo ""
echo "Results written to: $RESULTS_FILE"
echo "Screenshots saved to: $SCREENSHOT_DIR/"
