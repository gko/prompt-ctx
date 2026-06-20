import { test, expect, beforeEach, afterAll } from "bun:test";
import { mkdir, writeFile, rm, readdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const FIXTURES_DIR = path.join(import.meta.dir, "fixtures");
const CLI_PATH = path.resolve(__dirname, "../bin/prompt-ctx");

async function runCli(args: string[], cwd: string = FIXTURES_DIR) {
    const proc = Bun.spawn([CLI_PATH, ...args], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    return { stdout, stderr, exitCode };
}

async function getOutputContent() {
    const files = await readdir(FIXTURES_DIR);
    const outputFiles = files.filter(
        (f) => f.startsWith("output-") && f.endsWith(".txt"),
    );
    if (outputFiles.length === 0) return null;
    return await readFile(path.join(FIXTURES_DIR, outputFiles[0]), "utf-8");
}

beforeEach(async () => {
    if (existsSync(FIXTURES_DIR)) {
        await rm(FIXTURES_DIR, { recursive: true, force: true });
    }
    await mkdir(FIXTURES_DIR, { recursive: true });
});

afterAll(async () => {
    if (existsSync(FIXTURES_DIR)) {
        await rm(FIXTURES_DIR, { recursive: true, force: true });
    }
});

test("adds files and checks the hash in the file name", async () => {
    await writeFile(path.join(FIXTURES_DIR, "a.js"), "console.log('a');");
    await writeFile(path.join(FIXTURES_DIR, "b.js"), "console.log('b');");

    const { exitCode } = await runCli(["a.js", "b.js", "--out", "output.txt"]);
    expect(exitCode).toBe(0);

    const files = await readdir(FIXTURES_DIR);
    const outputFiles = files.filter(
        (f) => f.startsWith("output-") && f.endsWith(".txt"),
    );
    expect(outputFiles.length).toBe(1);

    const outputFile = outputFiles[0];
    const match = outputFile.match(/^output-([a-f0-9]{8})\.txt$/);
    expect(match).not.toBeNull();

    const content = await getOutputContent();
    expect(content).toContain("console.log('a');");
    expect(content).toContain("console.log('b');");
});

test("adds files and ignores files that are in .gitignore", async () => {
    await writeFile(path.join(FIXTURES_DIR, "a.js"), "console.log('a');");
    await writeFile(
        path.join(FIXTURES_DIR, "secret.js"),
        "console.log('secret');",
    );
    await writeFile(path.join(FIXTURES_DIR, ".gitignore"), "secret.js\n");

    const { exitCode } = await runCli([
        "a.js",
        "secret.js",
        "--out",
        "output.txt",
    ]);
    expect(exitCode).toBe(0);

    const content = await getOutputContent();
    expect(content).toContain("console.log('a');");
    expect(content).not.toContain("console.log('secret');");
});

test("adds folders and ignores some file patterns explicitly", async () => {
    await mkdir(path.join(FIXTURES_DIR, "src"));
    await mkdir(path.join(FIXTURES_DIR, "tests"));

    await writeFile(
        path.join(FIXTURES_DIR, "src/main.js"),
        "console.log('main');",
    );
    await writeFile(
        path.join(FIXTURES_DIR, "tests/main.test.js"),
        "console.log('test');",
    );

    const { exitCode } = await runCli([
        "src",
        "tests",
        "--exclude",
        "tests/*",
        "--out",
        "output.txt",
    ]);
    expect(exitCode).toBe(0);

    const content = await getOutputContent();
    expect(content).toContain("console.log('main');");
    expect(content).not.toContain("console.log('test');");
});

test("AST dependency tracing: automatically pulls in imported files", async () => {
    await mkdir(path.join(FIXTURES_DIR, "src"));
    await writeFile(
        path.join(FIXTURES_DIR, "src/utils.ts"),
        "export const hello = 'world';",
    );
    await writeFile(
        path.join(FIXTURES_DIR, "src/main.ts"),
        "import { hello } from './utils';\nconsole.log(hello);",
    );
    await writeFile(
        path.join(FIXTURES_DIR, "src/ignored.ts"),
        "console.log('I should not be here');",
    );

    // Pass ONLY main.ts, but expect utils.ts to be pulled in by AST tracing
    const { exitCode } = await runCli(["src/main.ts", "--out", "output.txt"]);
    expect(exitCode).toBe(0);

    const content = await getOutputContent();
    expect(content).toContain("import { hello } from './utils';");
    expect(content).toContain("export const hello = 'world';");
    expect(content).not.toContain("I should not be here"); // Unrelated file is ignored!
});

test("CSS @import crawling: pulls in dependent stylesheets", async () => {
    await mkdir(path.join(FIXTURES_DIR, "styles"));
    await writeFile(
        path.join(FIXTURES_DIR, "styles/reset.css"),
        "body { margin: 0; }",
    );
    await writeFile(
        path.join(FIXTURES_DIR, "styles/main.css"),
        "@import './reset.css';\n.app { color: red; }",
    );
    await writeFile(
        path.join(FIXTURES_DIR, "styles/ignored.css"),
        ".ignored { display: none; }",
    );

    const { exitCode } = await runCli([
        "styles/main.css",
        "--out",
        "output.txt",
    ]);
    expect(exitCode).toBe(0);

    const content = await getOutputContent();
    expect(content).toContain(".app { color: red; }");
    expect(content).toContain("body { margin: 0; }");
    expect(content).not.toContain(".ignored");
});

test("Safety features: automatically drops .env files", async () => {
    await writeFile(path.join(FIXTURES_DIR, "a.js"), "console.log('a');");
    await writeFile(path.join(FIXTURES_DIR, ".env"), "SECRET=SUPER_SECRET");

    const { exitCode } = await runCli(["a.js", ".env", "--out", "output.txt"]);
    expect(exitCode).toBe(0);

    const content = await getOutputContent();
    expect(content).toContain("console.log('a');");
    expect(content).not.toContain("SUPER_SECRET");
});

test("Binary files are dropped, text scripts are preserved", async () => {
    // Dockerfile (extensionless, but text)
    await writeFile(
        path.join(FIXTURES_DIR, "Dockerfile"),
        "FROM ubuntu:latest",
    );
    // Binary file mockup
    await writeFile(
        path.join(FIXTURES_DIR, "image.png"),
        Buffer.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00,
        ]),
    );

    const { exitCode } = await runCli([
        "Dockerfile",
        "image.png",
        "--out",
        "output.txt",
    ]);
    expect(exitCode).toBe(0);

    const content = await getOutputContent();
    expect(content).toContain("FROM ubuntu:latest");
    expect(content).toContain("[BINARY, EXCLUDED, OR NON-TEXT FILE OMITTED]");
});

test("tricky trace: index.html with tsx and css, using --exclude", async () => {
    await mkdir(path.join(FIXTURES_DIR, "src"));
    await mkdir(path.join(FIXTURES_DIR, "src/components"));

    await writeFile(
        path.join(FIXTURES_DIR, "index.html"),
        "<script type='module' src='./src/main.tsx'></script>",
    );

    await writeFile(
        path.join(FIXTURES_DIR, "src/main.tsx"),
        "import './styles.css'; import { App } from './components/App'; console.log(App);",
    );
    await writeFile(
        path.join(FIXTURES_DIR, "src/styles.css"),
        "body { background: black; }",
    );

    await writeFile(
        path.join(FIXTURES_DIR, "src/components/App.tsx"),
        "export const App = () => <div>App</div>;",
    );
    await writeFile(
        path.join(FIXTURES_DIR, "src/components/SecretAdmin.tsx"),
        "export const Admin = () => <div>Secret</div>;",
    );

    // We pass index.html, it should pull in main.tsx -> styles.css and App.tsx
    // However, we exclude components/* so App.tsx should NOT be pulled in
    const { exitCode } = await runCli([
        "index.html",
        "--exclude",
        "src/components/*",
        "--out",
        "output.txt",
    ]);
    expect(exitCode).toBe(0);

    const content = await getOutputContent();
    expect(content).toContain(
        "<script type='module' src='./src/main.tsx'></script>",
    );
    expect(content).toContain("import './styles.css';");
    expect(content).toContain("body { background: black; }");

    // The excluded component should NOT be there
    expect(content).not.toContain("export const App");
    // The completely unreferenced component shouldn't be there either
    expect(content).not.toContain("SecretAdmin");
});

test("deduplicates files included via multiple paths (AST, direct, glob)", async () => {
    await mkdir(path.join(FIXTURES_DIR, "src"));
    await writeFile(
        path.join(FIXTURES_DIR, "src/utils.ts"),
        "export const util = true;",
    );
    await writeFile(
        path.join(FIXTURES_DIR, "src/main.ts"),
        "import { util } from './utils'; console.log(util);",
    );

    // We include it via:
    // 1. Entrypoint (main.ts imports utils.ts)
    // 2. Direct inclusion (utils.ts)
    // 3. Glob inclusion (src/* includes utils.ts)
    const { exitCode } = await runCli([
        "src/main.ts",
        "src/utils.ts",
        "src/*",
        "--out",
        "output.txt",
    ]);
    expect(exitCode).toBe(0);

    const content = await getOutputContent();
    if (!content) throw new Error("Output content is null");

    // Check that 'utils.ts' header only appears exactly once in the final packed file
    const utilMatches = content.match(/\/\/ File: src\/utils\.ts/g);
    expect(utilMatches).not.toBeNull();
    expect(utilMatches?.length).toBe(1);

    // Check that 'main.ts' header also only appears exactly once
    const mainMatches = content.match(/\/\/ File: src\/main\.ts/g);
    expect(mainMatches).not.toBeNull();
    expect(mainMatches?.length).toBe(1);
});

test("Vite path resolver: handles absolute paths matching project root, public, and assets dir", async () => {
    await mkdir(path.join(FIXTURES_DIR, "src"));
    await mkdir(path.join(FIXTURES_DIR, "public"));
    await mkdir(path.join(FIXTURES_DIR, "assets"));

    // index.html referencing absolute paths
    await writeFile(
        path.join(FIXTURES_DIR, "index.html"),
        `<!doctype html>
        <html lang="en">
          <head>
            <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
            <link rel="icon" href="/logo.png" />
            <link rel="stylesheet" href="/missing.css" />
          </head>
          <body>
            <script type="module" src="/src/main.ts"></script>
          </body>
        </html>`,
    );

    await writeFile(
        path.join(FIXTURES_DIR, "src/main.ts"),
        "console.log('absolute src matched');",
    );
    await writeFile(
        path.join(FIXTURES_DIR, "public/favicon.svg"),
        "<svg>favicon</svg>",
    );
    await writeFile(
        path.join(FIXTURES_DIR, "assets/logo.png"),
        "<png>logo</png>",
    ); // Mock image

    const { exitCode } = await runCli(["index.html", "--out", "output.txt"]);
    expect(exitCode).toBe(0);

    const content = await getOutputContent();
    if (!content) throw new Error("Output content is null");

    // The src file should be correctly included
    expect(content).toContain("console.log('absolute src matched');");

    // Note: The binary image file (logo.png) might be skipped by checkIsTextFile,
    // but its path should be resolved successfully without crashing.
    // favicon.svg is also stripped as non-text (image/svg+xml), but the path should be present!
    expect(content).toContain("File: public/favicon.svg");
    expect(content).toContain("File: assets/logo.png");
    expect(content).toContain("File: src/main.ts");

    // The missing.css file should NOT be in the output, but it shouldn't crash the build
    expect(content).not.toContain("File: missing.css");
});

test(".gitignore: correctly handles nested wildcards and root-anchored rules", async () => {
    // We want to test that `*.log` matches `src/errors.log`
    // And `/dist` matches `dist` but NOT `src/dist`
    // And `build/` matches `build` but NOT `src/build` (wait, actually `build/` anchored to root by the slash! So it shouldn't match src/build)

    await writeFile(
        path.join(FIXTURES_DIR, ".gitignore"),
        `*.log
/dist
build/
`,
    );

    await mkdir(path.join(FIXTURES_DIR, "src"));
    await mkdir(path.join(FIXTURES_DIR, "dist"));
    await mkdir(path.join(FIXTURES_DIR, "src/dist"));
    await mkdir(path.join(FIXTURES_DIR, "build"));
    await mkdir(path.join(FIXTURES_DIR, "src/build"));

    // Nested wildcard
    await writeFile(
        path.join(FIXTURES_DIR, "src/errors.log"),
        "error log content",
    );
    // Root anchored
    await writeFile(path.join(FIXTURES_DIR, "dist/main.js"), "dist content");
    // Nested same name (should be kept)
    await writeFile(
        path.join(FIXTURES_DIR, "src/dist/main.js"),
        "src dist content",
    );
    // Root anchored (due to slash)
    await writeFile(path.join(FIXTURES_DIR, "build/app.js"), "build content");
    // Nested same name (should be excluded because `build/` without a middle/start slash matches anywhere)
    await writeFile(
        path.join(FIXTURES_DIR, "src/build/app.js"),
        "src build content",
    );

    await writeFile(
        path.join(FIXTURES_DIR, "index.js"),
        "console.log('hello');",
    );

    const { exitCode } = await runCli([".", "--out", "output.txt"]);
    expect(exitCode).toBe(0);

    const content = await getOutputContent();
    if (!content) throw new Error("Output content is null");

    // Standard inclusion
    expect(content).toContain("File: index.js");

    // Wildcard matches nested file
    expect(content).not.toContain("File: src/errors.log");

    // Root-anchored /dist excludes root dist but NOT src/dist
    expect(content).not.toContain("File: dist/main.js");
    expect(content).toContain("File: src/dist/main.js");

    // Unanchored directory build/ excludes BOTH root build and src/build
    expect(content).not.toContain("File: build/app.js");
    expect(content).not.toContain("File: src/build/app.js");
});

test("TypeScript .d.ts tracking: safely recovers types dropped by AST bundler", async () => {
    // Bun's AST bundler drops files that emit no runtime code (e.g. ambient types or import type)
    // We want to ensure prompt-ctx recovers them via crawlTypeImports.

    await writeFile(
        path.join(FIXTURES_DIR, "index.ts"),
        `
        import type { User } from "./types";
        import { processUser } from "./utils";
        console.log("running");
    `,
    );

    // Standalone type file
    await writeFile(
        path.join(FIXTURES_DIR, "types.d.ts"),
        `
        export interface User { id: string; }
    `,
    );

    // Normal imported file
    await writeFile(
        path.join(FIXTURES_DIR, "utils.ts"),
        `
        export const processUser = (u: any) => {};
    `,
    );

    const { exitCode } = await runCli(["index.ts", "--out", "output.txt"]);
    expect(exitCode).toBe(0);

    const content = await getOutputContent();
    if (!content) throw new Error("Output content is null");

    // The runtime dependency should be there
    expect(content).toContain("File: utils.ts");

    // The type dependency should ALSO be recovered!
    expect(content).toContain("File: types.d.ts");
    expect(content).toContain("export interface User");
});

test("Safety features: catches nested .gitignore exclusions matching exact filenames", async () => {
    await mkdir(path.join(FIXTURES_DIR, "src/nested/deep"), {
        recursive: true,
    });
    await writeFile(
        path.join(FIXTURES_DIR, "src/main.js"),
        "console.log('main');",
    );
    await writeFile(
        path.join(FIXTURES_DIR, "src/nested/deep/database.sqlite"),
        "binary_mock",
    );

    // Root gitignore ignoring the exact file name anywhere in the tree
    await writeFile(path.join(FIXTURES_DIR, ".gitignore"), "database.sqlite\n");

    const { exitCode } = await runCli(["src", "--out", "output.txt"]);
    expect(exitCode).toBe(0);

    const content = await getOutputContent();
    expect(content).toContain("console.log('main');");
    expect(content).not.toContain("database.sqlite");
});

test("UTF-8 parsing: safely preserves non-ASCII localized text and emojis", async () => {
    await writeFile(
        path.join(FIXTURES_DIR, "multilingual.js"),
        "// こんにちは世界\nconst greeting = '你好'; // 🚀🚀🚀",
    );

    const { exitCode } = await runCli([
        "multilingual.js",
        "--out",
        "output.txt",
    ]);
    expect(exitCode).toBe(0);

    const content = await getOutputContent();
    expect(content).toContain("こんにちは世界");
    expect(content).toContain("你好");
    expect(content).toContain("🚀🚀🚀");
});

test(".gitignore whitelists: properly preserves explicitly whitelisted files (!)", async () => {
    // Setup a scenario where config/*.json is excluded, but config/production.json is whitelisted
    await mkdir(path.join(FIXTURES_DIR, "config"), { recursive: true });
    await writeFile(
        path.join(FIXTURES_DIR, "config/dev.json"),
        '{ "dev": true }',
    );
    await writeFile(
        path.join(FIXTURES_DIR, "config/production.json"),
        '{ "prod": true }',
    );
    await writeFile(
        path.join(FIXTURES_DIR, ".gitignore"),
        `
config/*.json
!config/production.json
    `.trim(),
    );

    // Run on the config folder
    const { exitCode } = await runCli(["config", "--out", "output.txt"]);
    expect(exitCode).toBe(0);

    const content = await getOutputContent();
    if (!content) throw new Error("Output content is null");

    // config/dev.json should be missing
    expect(content).not.toContain("File: config/dev.json");

    // config/production.json should be present due to the whitelist
    expect(content).toContain("File: config/production.json");
    expect(content).toContain('{ "prod": true }');
});

test("CLI --exclude: correctly handles unanchored wildcards for deeply nested files", async () => {
    // Create deeply nested files
    await mkdir(path.join(FIXTURES_DIR, "src/utils"), { recursive: true });
    await writeFile(
        path.join(FIXTURES_DIR, "src/utils/auth.ts"),
        "export const auth = () => {};",
    );
    await writeFile(
        path.join(FIXTURES_DIR, "src/utils/auth.spec.ts"),
        "describe('auth', () => {});",
    );

    // Run CLI excluding *.spec.ts
    const { exitCode } = await runCli([
        "src",
        "--exclude",
        "*.spec.ts",
        "--out",
        "output.txt",
    ]);
    expect(exitCode).toBe(0);

    const content = await getOutputContent();
    if (!content) throw new Error("Output content is null");

    // src/utils/auth.ts should be present
    expect(content).toContain("File: src/utils/auth.ts");

    // src/utils/auth.spec.ts should be excluded
    expect(content).not.toContain("File: src/utils/auth.spec.ts");
});

test("Dynamic Workspace .gitignore (Monorepo): parses nested gitignores and applies them locally", async () => {
    // Setup monorepo structure
    await mkdir(path.join(FIXTURES_DIR, "apps/web/dist"), { recursive: true });
    await mkdir(path.join(FIXTURES_DIR, "packages/ui/dist"), {
        recursive: true,
    });

    // Valid source files
    await writeFile(
        path.join(FIXTURES_DIR, "apps/web/index.ts"),
        "console.log('web');",
    );
    await writeFile(
        path.join(FIXTURES_DIR, "packages/ui/index.ts"),
        "console.log('ui');",
    );

    // Dist files that should be ignored
    await writeFile(
        path.join(FIXTURES_DIR, "apps/web/dist/bundle.js"),
        "web_bundle",
    );
    await writeFile(
        path.join(FIXTURES_DIR, "packages/ui/dist/bundle.js"),
        "ui_bundle",
    );

    // The root gitignore
    await writeFile(path.join(FIXTURES_DIR, ".gitignore"), "node_modules/\n");

    // The localized nested gitignores
    await writeFile(path.join(FIXTURES_DIR, "apps/web/.gitignore"), "dist/\n");
    await writeFile(
        path.join(FIXTURES_DIR, "packages/ui/.gitignore"),
        "dist/\n",
    );

    const { exitCode } = await runCli(
        [".", "--out", "output.txt"],
        FIXTURES_DIR,
    );
    expect(exitCode).toBe(0);

    const content = await getOutputContent(FIXTURES_DIR);
    if (!content) throw new Error("Output content is null");

    // Should include standard source
    expect(content).toContain("File: apps/web/index.ts");
    expect(content).toContain("File: packages/ui/index.ts");

    // Must NOT include nested dist folders due to localized .gitignore evaluation
    expect(content).not.toContain("File: apps/web/dist/bundle.js");
    expect(content).not.toContain("File: packages/ui/dist/bundle.js");
});

test("Level 6000: Variadic CLI --exclude swallows multiple files", async () => {
    await writeFile(path.join(FIXTURES_DIR, "index.ts"), "const a = 1;");
    await writeFile(path.join(FIXTURES_DIR, "drop1.ts"), "const b = 2;");
    await writeFile(path.join(FIXTURES_DIR, "drop2.ts"), "const c = 3;");
    await writeFile(path.join(FIXTURES_DIR, "keep.ts"), "const d = 4;");

    const { exitCode } = await runCli([
        "index.ts",
        "keep.ts",
        "--exclude",
        "drop1.ts",
        "drop2.ts",
        "--out",
        "output.txt",
    ]);
    expect(exitCode).toBe(0);

    const content = await getOutputContent();
    if (!content) throw new Error("Output content is null");

    expect(content).toContain("File: index.ts");
    expect(content).toContain("File: keep.ts");
    expect(content).not.toContain("File: drop1.ts");
    expect(content).not.toContain("File: drop2.ts");
});

test("Level 6000: CLI exclusions strictly override .gitignore whitelists", async () => {
    await mkdir(path.join(FIXTURES_DIR, "config"), { recursive: true });
    await writeFile(path.join(FIXTURES_DIR, "config/database.json"), "secret");
    await writeFile(
        path.join(FIXTURES_DIR, ".gitignore"),
        `
config/*
!config/database.json
    `.trim(),
    );

    // CLI explicitly excludes the whitelisted database.json
    const { exitCode } = await runCli([
        "config",
        "--exclude",
        "config/database.json",
        "--out",
        "output.txt",
    ]);
    expect(exitCode).toBe(0);

    const content = await getOutputContent();
    if (!content) throw new Error("Output content is null");

    // The file MUST be excluded despite the gitignore whitelist!
    expect(content).not.toContain("File: config/database.json");
});

test("Level 6000: Monorepo deep exclusions strictly override higher whitelists", async () => {
    await mkdir(path.join(FIXTURES_DIR, "packages/api/dist"), {
        recursive: true,
    });
    await writeFile(
        path.join(FIXTURES_DIR, "packages/api/index.ts"),
        "api_index",
    );
    await writeFile(
        path.join(FIXTURES_DIR, "packages/api/dist/bundle.js"),
        "api_bundle",
    );

    // Root says "whitelist all dist files"
    await writeFile(path.join(FIXTURES_DIR, ".gitignore"), `!dist/\n`);

    // Deeper package explicitly ignores dist again
    await writeFile(
        path.join(FIXTURES_DIR, "packages/api/.gitignore"),
        `dist/\n`,
    );

    const { exitCode } = await runCli(["packages", "--out", "output.txt"]);
    expect(exitCode).toBe(0);

    const content = await getOutputContent();
    if (!content) throw new Error("Output content is null");

    expect(content).toContain("File: packages/api/index.ts");
    // The deep exclusion must win over the root whitelist
    expect(content).not.toContain("File: packages/api/dist/bundle.js");
});

// ==========================================
// NEW TESTS FOR RECENT FIXES
// ==========================================

test("Self-exclusion works when output is in a subdirectory", async () => {
    await mkdir(path.join(FIXTURES_DIR, "dist"), { recursive: true });
    await writeFile(
        path.join(FIXTURES_DIR, "index.ts"),
        "console.log('hello');",
    );

    const { exitCode } = await runCli([
        "index.ts",
        "--out",
        "dist/llm-context.txt",
    ]);
    expect(exitCode).toBe(0);

    // The tool should not crash and should produce the file
    const files = await readdir(path.join(FIXTURES_DIR, "dist"));
    const outputFiles = files.filter(
        (f) => f.startsWith("llm-context-") && f.endsWith(".txt"),
    );
    expect(outputFiles.length).toBe(1);
});

test("gitignore rules work correctly with folder/* pattern", async () => {
    await mkdir(path.join(FIXTURES_DIR, "src"), { recursive: true });
    await writeFile(
        path.join(FIXTURES_DIR, "src/main.ts"),
        "console.log('main');",
    );
    await writeFile(
        path.join(FIXTURES_DIR, "src/test.ts"),
        "console.log('test');",
    );

    await writeFile(path.join(FIXTURES_DIR, ".gitignore"), "src/*\n");

    const { exitCode } = await runCli(["src", "--out", "output.txt"]);
    expect(exitCode).toBe(0);

    const content = await getOutputContent();
    expect(content).not.toContain("File: src/main.ts");
    expect(content).not.toContain("File: src/test.ts");
});
