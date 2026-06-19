import { test, expect, beforeEach, afterAll } from "bun:test";
import { mkdir, writeFile, rm, readdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const FIXTURES_DIR = path.join(import.meta.dir, "fixtures");
const CLI_PATH = path.resolve(__dirname, "../context");

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

    const { exitCode, stdout, stderr } = await runCli(["a.js", "b.js", "--out", "output.txt"]);
    expect(exitCode).toBe(0);

    const files = await readdir(FIXTURES_DIR);
    const outputFiles = files.filter(f => f.startsWith("output-") && f.endsWith(".txt"));
    
    expect(outputFiles.length).toBe(1);
    
    const outputFile = outputFiles[0];
    const match = outputFile.match(/^output-([a-f0-9]{8})\.txt$/);
    expect(match).not.toBeNull();
    
    const content = await readFile(path.join(FIXTURES_DIR, outputFile), "utf-8");
    expect(content).toContain("console.log('a');");
    expect(content).toContain("console.log('b');");
});

test("adds files and ignores files that are in .gitignore", async () => {
    await writeFile(path.join(FIXTURES_DIR, "a.js"), "console.log('a');");
    await writeFile(path.join(FIXTURES_DIR, "secret.js"), "console.log('secret');");
    await writeFile(path.join(FIXTURES_DIR, ".gitignore"), "secret.js\n");

    const { exitCode } = await runCli(["a.js", "secret.js", "--out", "output.txt"]);
    expect(exitCode).toBe(0);

    const files = await readdir(FIXTURES_DIR);
    const outputFiles = files.filter(f => f.startsWith("output-") && f.endsWith(".txt"));
    expect(outputFiles.length).toBe(1);
    
    const content = await readFile(path.join(FIXTURES_DIR, outputFiles[0]), "utf-8");
    expect(content).toContain("console.log('a');");
    expect(content).not.toContain("console.log('secret');");
});

test("adds folders and ignores some file patterns and doesn't see these files", async () => {
    await mkdir(path.join(FIXTURES_DIR, "src"));
    await mkdir(path.join(FIXTURES_DIR, "tests"));
    
    await writeFile(path.join(FIXTURES_DIR, "src/main.js"), "console.log('main');");
    await writeFile(path.join(FIXTURES_DIR, "tests/main.test.js"), "console.log('test');");

    // Testing passing folders directly
    const { exitCode } = await runCli(["src", "tests", "--exclude", "tests/*", "--out", "output.txt"]);
    expect(exitCode).toBe(0);

    const files = await readdir(FIXTURES_DIR);
    const outputFiles = files.filter(f => f.startsWith("output-") && f.endsWith(".txt"));
    expect(outputFiles.length).toBe(1);
    
    const content = await readFile(path.join(FIXTURES_DIR, outputFiles[0]), "utf-8");
    expect(content).toContain("console.log('main');");
    expect(content).not.toContain("console.log('test');");
});
