# prompt-ctx

[![Run Tests](https://github.com/gko/prompt-ctx/actions/workflows/test.yml/badge.svg)](https://github.com/gko/prompt-ctx/actions/workflows/test.yml)

A fast, AST-aware tool to assemble project context into a single text file for Large Language Model (LLM) prompts, powered by Bun.

## Usage

You can run `prompt-ctx` directly using `bunx` without having to install it globally:

```bash
bunx prompt-ctx src/**/*.ts --out context.txt
```

### Options

- `<includes...>`: Files, directories, or globs to include in the context.
- `--exclude <excludes...>`: Glob patterns or paths to ignore. This automatically merges with your `.gitignore`.
- `--out <output-file>`: The target output filename (default: `llm-context.txt`). The final filename will automatically include a short SHA256 hash of the content (e.g., `context-a1b2c3d4.txt`).
