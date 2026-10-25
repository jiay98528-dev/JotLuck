use serde::Serialize;
use std::collections::BTreeMap;

pub type CommandResult<T> = Result<T, CommandErrorPayload>;

/// 结构化错误码：外部文件授权失效。发射点必须复用下方消息常量，
/// 使 `from_diagnostic` 的精确匹配永不因文本漂移而错配错误码。
pub const CODE_EXTERNAL_GRANT_EXPIRED: &str = "external_grant_expired";
/// 结构化错误码：文档转换已过期，需要重新转换源文件。
pub const CODE_CONVERSION_STALE: &str = "conversion_stale";

/// `ExternalAccessGrants` 各授权校验点共享的失效消息（fs_ops.rs）。
pub const EXTERNAL_GRANT_EXPIRED_MESSAGE: &str = "external access grant is invalid or expired";
/// `DocumentImportState` 源文件过期校验点共享的过期消息（document_import.rs）。
pub const CONVERSION_STALE_MESSAGE: &str =
    "document conversion is stale; reconvert the source before editing";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandErrorPayload {
    pub code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<BTreeMap<String, String>>,
    #[serde(skip_serializing)]
    pub diagnostic: Option<String>,
}

impl CommandErrorPayload {
    pub fn from_diagnostic(message: impl Into<String>) -> Self {
        let diagnostic = message.into();
        // 结构化错误码优先按共享常量精确匹配，其余诊断文本再走子串分类。
        let code = if diagnostic == EXTERNAL_GRANT_EXPIRED_MESSAGE {
            CODE_EXTERNAL_GRANT_EXPIRED
        } else if diagnostic == CONVERSION_STALE_MESSAGE {
            CODE_CONVERSION_STALE
        } else {
            classify_diagnostic(&diagnostic.to_lowercase())
        };
        let args = if code == "file_too_large" {
            Some(BTreeMap::from([(
                "maxSize".to_string(),
                "5 MB".to_string(),
            )]))
        } else {
            None
        };
        Self {
            code: code.to_string(),
            args,
            diagnostic: Some(diagnostic),
        }
    }
}

fn classify_diagnostic(normalized: &str) -> &'static str {
    if normalized.contains("not found")
        || normalized.contains("no such file")
        || normalized.contains("不存在")
        || normalized.contains("找不到")
    {
        "not_found"
    } else if normalized.contains("permission")
        || normalized.contains("access is denied")
        || normalized.contains("权限")
    {
        "permission_denied"
    } else if normalized.contains("already exists") || normalized.contains("已存在") {
        "already_exists"
    } else if normalized.contains("path traversal")
        || normalized.contains("outside")
        || normalized.contains("超出笔记本")
        || normalized.contains("不在当前笔记本")
    {
        "outside_notebook"
    } else if normalized.contains("invalid path")
        || normalized.contains("invalid chars")
        || normalized.contains("路径为空")
        || normalized.contains("路径包含非法")
    {
        "invalid_path"
    } else if normalized.contains("utf-8") || normalized.contains("utf8") {
        "not_utf8"
    } else if normalized.contains("too large")
        || normalized.contains("超过读取上限")
        || normalized.contains("超过 5 mb")
    {
        "file_too_large"
    } else if normalized.contains("conflict") || normalized.contains("revision") {
        "conflict"
    } else if normalized.contains("disk full")
        || normalized.contains("not enough space")
        || normalized.contains("空间不足")
    {
        "disk_full"
    } else if normalized.contains("notebook")
        && (normalized.contains("not open")
            || normalized.contains("root is not set")
            || normalized.contains("未打开"))
    {
        "notebook_not_open"
    } else if normalized.contains("index") || normalized.contains("索引") {
        "index_unavailable"
    } else {
        "operation_failed"
    }
}

impl From<String> for CommandErrorPayload {
    fn from(value: String) -> Self {
        Self::from_diagnostic(value)
    }
}

impl From<&str> for CommandErrorPayload {
    fn from(value: &str) -> Self {
        Self::from_diagnostic(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_stable_error_codes_without_serializing_diagnostics() {
        let error = CommandErrorPayload::from_diagnostic("文件不存在: /missing.md");
        assert_eq!(error.code, "not_found");
        let wire = serde_json::to_value(error).expect("serialize command error");
        assert_eq!(wire, serde_json::json!({ "code": "not_found" }));

        let oversized = CommandErrorPayload::from_diagnostic("外部文件在读取时超过 5 MB");
        assert_eq!(oversized.code, "file_too_large");
        assert_eq!(
            oversized.args,
            Some(BTreeMap::from([(
                "maxSize".to_string(),
                "5 MB".to_string()
            )]))
        );
    }

    #[test]
    fn maps_shared_grant_and_stale_messages_to_structured_codes_on_the_wire() {
        let grant = CommandErrorPayload::from_diagnostic(EXTERNAL_GRANT_EXPIRED_MESSAGE);
        assert_eq!(grant.code, CODE_EXTERNAL_GRANT_EXPIRED);
        assert_eq!(
            serde_json::to_value(&grant).expect("serialize grant error"),
            serde_json::json!({ "code": CODE_EXTERNAL_GRANT_EXPIRED })
        );

        let stale = CommandErrorPayload::from_diagnostic(CONVERSION_STALE_MESSAGE);
        assert_eq!(stale.code, CODE_CONVERSION_STALE);
        assert_eq!(
            serde_json::to_value(&stale).expect("serialize stale error"),
            serde_json::json!({ "code": CODE_CONVERSION_STALE })
        );
    }

    #[test]
    fn keeps_unrelated_diagnostics_on_the_generic_operation_code() {
        let other = CommandErrorPayload::from_diagnostic("external edit grant does not match");
        assert_eq!(other.code, "operation_failed");
    }
}
