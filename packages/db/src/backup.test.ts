import { copyFile, mkdtemp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { backupDatabase } from "./backup";
import type { Db } from "./index";
import * as schema from "./schema/schema";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, copyFile: vi.fn<typeof original.copyFile>(original.copyFile) };
});

let workspace: string;
let directory: string;
let source: Client;
let db: Db;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "database-backup-test-"));
  directory = join(workspace, "cloud folder's backups");
  await mkdir(directory);
  source = createClient({ url: pathToFileURL(join(workspace, "source.db")).href });
  db = drizzle(source, { schema });
  await source.execute("PRAGMA journal_mode=WAL");
  await source.execute("PRAGMA wal_autocheckpoint=0");
  await source.execute(
    "CREATE TABLE records (id INTEGER PRIMARY KEY, label TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  );
  await source.execute("INSERT INTO records VALUES (1, 'User A', '2026-01-01', '2026-01-01')");
});

afterEach(async () => {
  source.close();
  await rm(workspace, { recursive: true, force: true });
});

test("WALの確定済みデータを単独で復元でき、後の更新がバックアップに影響しない", async () => {
  expect((await stat(join(workspace, "source.db-wal"))).size).toBeGreaterThan(0);
  const destination = await backupDatabase(db, directory);
  await source.execute("UPDATE records SET label = 'User B' WHERE id = 1");
  const restored = createClient({ url: pathToFileURL(destination).href });
  try {
    expect((await restored.execute("SELECT label FROM records")).rows[0]?.[0]).toBe("User A");
    expect((await restored.execute("PRAGMA integrity_check")).rows[0]?.[0]).toBe("ok");
  } finally {
    restored.close();
  }
  expect((await stat(destination)).mode & 0o777).toBe(0o600);
  expect(await readdir(directory)).toEqual([destination.slice(directory.length + 1)]);
});

test("再実行しても既存のバックアップを上書きしない", async () => {
  const first = await backupDatabase(db, directory);
  const second = await backupDatabase(db, directory);
  expect(first).not.toBe(second);
  expect(await readdir(directory)).toHaveLength(2);
});

test("生成失敗時に一時ファイルを削除して既存バックアップを保持する", async () => {
  const previous = await backupDatabase(db, directory);
  const run = vi.spyOn(db, "run").mockRejectedValueOnce(new Error("snapshot failed"));
  await expect(backupDatabase(db, directory)).rejects.toThrow("snapshot failed");
  run.mockRestore();
  expect(await readdir(directory)).toEqual([previous.slice(directory.length + 1)]);
});

test("コピーが破損していたら完成ファイルとして公開しない", async () => {
  vi.mocked(copyFile).mockImplementationOnce(async (_source, destination) => {
    await writeFile(destination, "invalid SQLite snapshot");
  });
  await expect(backupDatabase(db, directory)).rejects.toThrow(/not a database/i);
  expect(await readdir(directory)).toEqual([]);
  expect((await source.execute("SELECT label FROM records")).rows[0]?.[0]).toBe("User A");
});

test("別接続で更新中でも未確定データをバックアップに含めない", async () => {
  const reader = createClient({ url: pathToFileURL(join(workspace, "source.db")).href });
  const transaction = await source.transaction("write");
  try {
    await transaction.execute("UPDATE records SET label = 'User B' WHERE id = 1");
    const destination = await backupDatabase(drizzle(reader, { schema }), directory);
    const restored = createClient({ url: pathToFileURL(destination).href });
    try {
      expect((await restored.execute("SELECT label FROM records")).rows[0]?.[0]).toBe("User A");
    } finally {
      restored.close();
    }
  } finally {
    await transaction.rollback();
    transaction.close();
    reader.close();
  }
});

test("相対パス・存在しないフォルダ・通常ファイルを保存先に指定できない", async () => {
  await expect(backupDatabase(db, "relative")).rejects.toThrow("absolute path");
  await expect(backupDatabase(db, join(workspace, "missing"))).rejects.toThrow(/ENOENT/);
  const file = join(workspace, "file");
  await writeFile(file, "placeholder");
  await expect(backupDatabase(db, file)).rejects.toThrow("existing directory");
  expect(await readdir(directory)).toEqual([]);
});
