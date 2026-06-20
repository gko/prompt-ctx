# prompt-ctx

[![Run Tests](https://github.com/gko/prompt-ctx/actions/workflows/test.yml/badge.svg)](https://github.com/gko/prompt-ctx/actions/workflows/test.yml)

The Bun-native, AST-aware context packer. Point it at your entrypoints, and it automatically follows the import graph for you.

`prompt-ctx` is a zero-dependency CLI tool built on top of Bun that packs your modern JS/TS projects into a single text file tailored for Large Language Models (LLMs).

---

## The Problem: Globs are Dumb

Most "repo-to-text" tools rely purely on globs (`**/*.ts`). In a modern codebase, this means you often pull in hundreds of irrelevant utility files, testing mocks, and disconnected components just because they live in the same directory, bloating your context window and confusing the LLM.

## The Solution: AST-Aware Tracing

`prompt-ctx` doesn't just scan files; it uses Bun's internal bundler to **understand your code**.
If you point it at a single entrypoint like `src/app.tsx`, it will trace the Abstract Syntax Tree (AST), follow all the `import` statements, and pack **exactly the files needed** to run that component—nothing more, nothing less.

It does this instantly, natively, and with zero external dependencies.

## Why this instead of Repomix / Yek / Gitingest?

Tools like **Repomix** are incredibly feature-rich and dominate the space for good reason. However, `prompt-ctx` is built specifically for a niche where it excels:

- **Smarter Context**: Repomix and others rely heavily on manual `.repomixignore` configurations or complex glob patterns to prune context. `prompt-ctx` relies on the code's actual import graph.
- **Tailor-made for Bun + Modern JS/TS**: Natively designed for the JS/TS ecosystem. It understands TypeScript, React, Vue, Svelte out of the box without needing to configure parsers.
- **CSS `@import` Crawling**: Automatically traces and includes dependent stylesheets.
- **Zero Bloat & Instant Execution**: No heavy node_modules. It runs directly via `bunx` in milliseconds.

If you want an all-in-one generic repository packer with advanced XML formatting and token counts, use Repomix.
If you want to pack **only the files that actually matter** for a specific feature you are working on, use `prompt-ctx`.

---

## Installation

You don't need to install anything to use it:

```bash
bunx prompt-ctx src/main.ts
```

Or install it globally:
```bash
bun add -g prompt-ctx
# or
npm install -g prompt-ctx
```

## Usage

You don't even need to install it. Run it instantly anywhere via `bunx`:

```bash
bunx prompt-ctx src/main.ts --out context.txt
```

### Examples

**1. Trace a specific component and its dependencies**
Provide the entry point, and `prompt-ctx` will pull the rest of the import graph automatically.
```bash
bunx prompt-ctx src/components/Button.tsx
```

**2. Standard folder globbing (with smart ignores)**
```bash
bunx prompt-ctx src/**/* --exclude src/tests/*
```

**3. Output to a specific file**
```bash
bunx prompt-ctx src/main.ts --out my-feature.txt
# Generates: my-feature-a1b2c3d4.txt (Includes an 8-char SHA automatically for cache busting)
```

### Options

- `<includes...>`: Entrypoints (traces AST), directories, or globs to include.
- `--exclude <excludes...>`: Glob patterns or paths to ignore. This automatically merges with your `.gitignore`.
- `--out <output-file>`: Target output filename (default: `llm-context.txt`).

### Built-in Safety

- **Secret Protection**: Explicitly ignores `.env` files to prevent leaking AWS or OpenAI keys to the LLM.
- **Binary Filtering**: Automatically detects mime-types (`file.type`) to gracefully skip binary files, images, and executables, guaranteeing a clean text output.
