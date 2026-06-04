// M6-06: Template rendering engine (Rust implementation)
//
// Replaces JavaScript TemplateEngine when running in Tauri mode.
// Supports the same 7 placeholders: {{date}}, {{time}}, {{datetime}},
// {{year}}, {{month}}, {{day}}, {{week}}.

use chrono::Local;

/// Render a template string by replacing all placeholders with current date/time values.
#[tauri::command]
pub fn render_template(template: String) -> Result<String, String> {
    let now = Local::now();
    let week_names = ["日", "一", "二", "三", "四", "五", "六"];
    let weekday = week_names
        .get(now.format("%u").to_string().parse::<usize>().unwrap_or(1) - 1)
        .unwrap_or(&"?");

    let result = template
        .replace("{{datetime}}", &now.format("%Y-%m-%d %H:%M:%S").to_string())
        .replace("{{date}}", &now.format("%Y-%m-%d").to_string())
        .replace("{{time}}", &now.format("%H:%M:%S").to_string())
        .replace("{{year}}", &now.format("%Y").to_string())
        .replace("{{month}}", &now.format("%m").to_string())
        .replace("{{day}}", &now.format("%d").to_string())
        .replace("{{week}}", &format!("周{}", weekday));

    Ok(result)
}

/// Get the default content for a built-in template.
#[tauri::command]
pub fn get_builtin_template(template_type: String) -> Result<String, String> {
    match template_type.as_str() {
        "diary" => Ok(r#"---
title: {{date}} 日记
tags: [diary]
created: {{date}}
---

# {{date}} {{week}}

## 今日待办

- [ ] 任务一
- [ ] 任务二
- [ ] 任务三

## 笔记

开始记录今天的想法...

## 总结

今天完成了什么？学到了什么？
"#
        .to_string()),

        "meeting" => Ok(r#"---
title: 会议纪要 — {{date}}
tags: [meeting]
created: {{date}}
---

# 会议纪要

- **日期**: {{date}} {{time}}
- **参会人**:
- **主题**:

## 议程

1.
2.
3.

## 讨论要点

### 议题一



### 议题二



## 决议

- [ ]
- [ ]

## 下一步行动

| 行动项 | 负责人 | 截止日期 |
|--------|--------|----------|
| | | |
"#
        .to_string()),

        "weekly" => Ok(r#"---
title: 周报 — {{date}}
tags: [weekly]
created: {{date}}
---

# 周报 {{date}}

> 周期：本周

## 本周完成

-
-
-

## 进行中

-
-

## 遇到的问题

-

## 下周计划

-
-
-

## 思考与收获

"#
        .to_string()),

        _ => Err(format!("未知模板类型: {}", template_type)),
    }
}
