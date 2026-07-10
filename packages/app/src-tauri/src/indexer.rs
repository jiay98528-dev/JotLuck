// M6-04: Tantivy full-text search indexer
//
// Builds and queries a full-text search index over supported note files
// in the notebook directory. Supports incremental updates.

use crate::fs_ops::NotebookRoot;
use crate::path::{display_path, resolve_safe_path};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;
use tantivy::schema::*;
use tantivy::tokenizer::*;
use tantivy::{doc, Index, IndexReader, IndexWriter, ReloadPolicy};
use tauri::State;

/// Search result returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResultItem {
    pub note_path: String,
    pub note_title: String,
    pub snippet: String,
    pub score: f32,
}

/// In-memory state: the tantivy index.
pub struct SearchIndex {
    pub index: Option<Index>,
    pub reader: Option<IndexReader>,
    pub writer: Option<std::sync::Mutex<IndexWriter>>,
    pub schema: Schema,
}

fn is_supported_note_path(path: &Path) -> bool {
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());
    matches!(ext.as_deref(), Some("md" | "markdown" | "mdx" | "txt"))
}

impl SearchIndex {
    pub fn new() -> Self {
        let mut schema_builder = Schema::builder();
        schema_builder.add_text_field("path", STRING | STORED);
        schema_builder.add_text_field("title", TEXT | STORED);
        schema_builder.add_text_field("content", TEXT);
        schema_builder.add_text_field("tags", TEXT);
        let schema = schema_builder.build();

        Self {
            index: None,
            reader: None,
            writer: None,
            schema,
        }
    }

    /// Open or create the index at the given directory.
    pub fn open(&mut self, index_dir: &Path) -> Result<(), String> {
        fs::create_dir_all(index_dir).map_err(|e| format!("创建索引目录失败: {}", e))?;

        let index = Index::open_or_create(
            tantivy::directory::MmapDirectory::open(index_dir).map_err(|e| e.to_string())?,
            self.schema.clone(),
        )
        .map_err(|e| format!("打开索引失败: {}", e))?;

        // Register Chinese tokenizer
        let tokenizer = TextAnalyzer::builder(SimpleTokenizer::default())
            .filter(LowerCaser)
            .build();
        index.tokenizers().register("default", tokenizer);

        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::OnCommitWithDelay)
            .try_into()
            .map_err(|e| format!("创建 reader 失败: {}", e))?;

        let writer = index
            .writer(50_000_000)
            .map_err(|e| format!("创建 writer 失败: {}", e))?;

        self.reader = Some(reader);
        self.writer = Some(std::sync::Mutex::new(writer));
        self.index = Some(index);

        Ok(())
    }

    /// Index a single markdown file.
    pub fn index_document(
        &self,
        path: &str,
        title: &str,
        content: &str,
        tags: &str,
    ) -> Result<(), String> {
        let writer_mutex = self.writer.as_ref().ok_or("索引未打开")?;
        let writer = writer_mutex.lock().map_err(|e| e.to_string())?;
        let path_field = self.schema.get_field("path").unwrap();
        let title_field = self.schema.get_field("title").unwrap();
        let content_field = self.schema.get_field("content").unwrap();
        let tags_field = self.schema.get_field("tags").unwrap();

        let path_term = tantivy::Term::from_field_text(path_field, path);
        writer.delete_term(path_term);

        writer
            .add_document(doc!(
                path_field => path,
                title_field => title,
                content_field => content,
                tags_field => tags,
            ))
            .map_err(|e| format!("添加文档失败: {}", e))?;

        Ok(())
    }

    pub fn remove_document(&self, path: &str) -> Result<(), String> {
        let writer_mutex = self.writer.as_ref().ok_or("索引未打开")?;
        let writer = writer_mutex.lock().map_err(|e| e.to_string())?;
        let path_field = self.schema.get_field("path").unwrap();
        let path_term = tantivy::Term::from_field_text(path_field, path);
        writer.delete_term(path_term);
        Ok(())
    }

    pub fn commit(&self) -> Result<(), String> {
        let writer_mutex = self.writer.as_ref().ok_or("索引未打开")?;
        let mut writer = writer_mutex.lock().map_err(|e| e.to_string())?;
        writer
            .commit()
            .map_err(|e| format!("提交索引失败: {}", e))?;
        Ok(())
    }

    /// Search the index.
    pub fn search(&self, query_str: &str, limit: usize) -> Result<Vec<SearchResultItem>, String> {
        let reader = self.reader.as_ref().ok_or("索引未打开")?;
        let searcher = reader.searcher();

        let content_field = self.schema.get_field("content").unwrap();
        let title_field = self.schema.get_field("title").unwrap();
        let path_field = self.schema.get_field("path").unwrap();

        let query_parser = QueryParser::for_index(
            self.index.as_ref().unwrap(),
            vec![title_field, content_field],
        );

        let query = query_parser
            .parse_query(query_str)
            .map_err(|e| format!("查询解析失败: {}", e))?;

        let top_docs = searcher
            .search(&query, &TopDocs::with_limit(limit))
            .map_err(|e| format!("搜索失败: {}", e))?;

        let mut results = Vec::new();
        for (score, doc_address) in top_docs {
            let doc: tantivy::TantivyDocument = searcher
                .doc(doc_address)
                .map_err(|e| format!("读取文档失败: {}", e))?;

            let note_path = doc
                .get_first(path_field)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let note_title = doc
                .get_first(title_field)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            // Generate snippet from content
            let content = doc
                .get_first(content_field)
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let snippet = generate_snippet(content, query_str, 80);

            results.push(SearchResultItem {
                note_path,
                note_title,
                snippet,
                score,
            });
        }

        Ok(results)
    }
}

/// Generate a context snippet around the search term.
fn generate_snippet(content: &str, query: &str, max_len: usize) -> String {
    let lower_content = content.to_lowercase();
    let lower_query = query.to_lowercase();

    if let Some(pos) = lower_content.find(&lower_query) {
        let start = pos.saturating_sub(30);
        let end = (pos + lower_query.len() + 50).min(content.len());

        let mut snippet = String::new();
        if start > 0 {
            snippet.push_str("...");
        }

        // Extract clean slice (handle UTF-8 boundaries)
        let slice: String = content.chars().skip(start).take(end - start).collect();

        snippet.push_str(&slice);
        if end < content.len() {
            snippet.push_str("...");
        }

        if snippet.len() > max_len {
            snippet = snippet.chars().take(max_len).collect();
            snippet.push_str("...");
        }

        snippet
    } else {
        content.chars().take(max_len).collect()
    }
}

// ============================================================
// IPC Commands
// ============================================================

/// Build full index from all supported note files in the notebook.
#[tauri::command]
pub fn build_index(
    index: State<Mutex<SearchIndex>>,
    root: State<NotebookRoot>,
) -> Result<usize, String> {
    let root_path = root.get().ok_or("未打开笔记本")?;
    let mut idx = index.lock().map_err(|e| e.to_string())?;
    let index_dir = root_path.join(".JotLuck_index");
    idx.open(&index_dir)?;

    let root = root_path.as_path();
    let mut count = 0;

    for entry in walkdir::WalkDir::new(root)
        .max_depth(10)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_file() {
            let path = entry.path();
            if is_supported_note_path(path) {
                let content = fs::read_to_string(path).unwrap_or_default();
                let title = extract_title(&content);
                let tags = extract_tags(&content);
                let rel = display_path(root, path);

                if let Err(e) = idx.index_document(&rel, &title, &content, &tags) {
                    log::warn!("索引失败 {}: {}", rel, e);
                } else {
                    count += 1;
                }
            }
        }
    }

    idx.commit()?;
    Ok(count)
}

/// Incrementally update a single file in the index.
#[tauri::command]
pub fn update_index_document(
    file_path: String,
    index: State<Mutex<SearchIndex>>,
    root: State<NotebookRoot>,
) -> Result<(), String> {
    let root_path = root.get().ok_or("未打开笔记本")?;
    let idx = index.lock().map_err(|e| e.to_string())?;
    let full = resolve_safe_path(&root_path, &file_path).map_err(|e| e.to_string())?;
    let indexed_path = display_path(&root_path, &full);

    if full.exists() {
        let content = fs::read_to_string(&full).unwrap_or_default();
        let title = extract_title(&content);
        let tags = extract_tags(&content);
        idx.index_document(&indexed_path, &title, &content, &tags)?;
    } else {
        idx.remove_document(&indexed_path)?;
    }

    idx.commit()?;
    Ok(())
}

/// Search the index.
#[tauri::command]
pub fn search_index(
    query: String,
    index: State<Mutex<SearchIndex>>,
) -> Result<Vec<SearchResultItem>, String> {
    let idx = index.lock().map_err(|e| e.to_string())?;
    idx.search(&query, 50)
}

/// Extract the first H1 title from markdown content.
fn extract_title(content: &str) -> String {
    for line in content.lines() {
        if let Some(title) = line.strip_prefix("# ") {
            return title.trim().to_string();
        }
        if line.starts_with("## ") {
            break;
        }
    }
    "Untitled".to_string()
}

/// Extract #tags from markdown content.
fn extract_tags(content: &str) -> String {
    let re = regex::Regex::new(r"#([\w\u{4e00}-\u{9fff}]+)").unwrap();
    let tags: Vec<&str> = re
        .captures_iter(content)
        .filter_map(|cap| cap.get(1))
        .map(|m| m.as_str())
        .collect();
    tags.join(" ")
}
