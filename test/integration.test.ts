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
