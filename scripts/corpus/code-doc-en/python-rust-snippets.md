# Python / Rust Documentation Corpus

Natural English documentation for N-gram training.

---

## Python Documentation Patterns

### Module Overview

This module provides utilities for processing Markdown files and extracting structured information. The main entry point is the `parse_document` function.

The parsing pipeline consists of three stages. First, the raw text is tokenized into a stream of tokens. Then, the tokens are assembled into block-level structures. Finally, metadata like headings, links, and tags are extracted from the blocks.

Each stage is implemented as a separate class to maintain separation of concerns. The stages communicate through well-defined interfaces.

### Function Reference

The `read_file` function opens a file and returns its contents as a string. It automatically detects the file encoding using byte order marks and falls back to UTF-8 if no encoding is detected.

If the file does not exist, a `FileNotFoundError` is raised with the full path. If permission is denied, a `PermissionError` is raised. Other IO errors are wrapped in a custom exception that preserves the original error information.

All exceptions in this module inherit from a common base class. This makes it easy to catch all file system related errors with a single except clause.

### Configuration

The library is configured through a dictionary of settings. Required settings must be provided at initialization time. Optional settings have sensible defaults that work for most use cases.

Configuration validation happens at import time. Invalid configurations raise an error immediately, rather than causing confusing failures later during actual usage.

---

## Rust Documentation Patterns

### Crate Overview

This crate provides filesystem operations for the Tauri backend. The main module exposes functions for reading, writing, and watching files on the local filesystem.

All path handling uses the standard library's Path and PathBuf types. Paths are validated before any filesystem operation to prevent path traversal attacks.

### Error Handling

All functions in this module return a Result type with a custom error enum. This allows callers to handle different error cases appropriately rather than catching generic failures.

The error types implement the standard Error trait and can be converted into user-facing messages. Each variant includes context about what operation was being performed when the error occurred.

### Concurrency

Shared state is protected by Mutex wrappers. The state manager holds the current notebook root path and any active file watchers. Access to this state must go through the lock to prevent data races.

File watchers run on a dedicated thread and communicate changes through a channel. The channel receiver is polled periodically and events are forwarded to the frontend through Tauri's event system.

### Building

The project uses Cargo for dependency management and building. Run `cargo build` for debug builds and `cargo build --release` for optimized production builds.

Tests are run with `cargo test`. Integration tests are located in the tests directory and test the full filesystem operation pipeline.
