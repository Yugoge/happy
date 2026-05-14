/**
 * Atomic JSON writer with crash-safety guarantees.
 *
 * Used by codex-mapping.json in this cycle. The persistence.ts:writeDaemonState
 * site has a similar defect but is DEFERRED per BA F3 (task-id 20260513-211054).
 *
 * Sequence (in order):
 *   1. Write payload to <target>.tmp.<pid> sibling file
 *   2. fsync the tmp file
 *   3. rename tmp -> target (POSIX-atomic on same filesystem)
 *   4. fsync the parent directory
 *
 * @module atomicWriteJson
 */

import { open, rename, unlink, readdir } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';

function tmpPathFor(targetPath: string): string {
    return join(dirname(targetPath), `${basename(targetPath)}.tmp.${process.pid}`);
}

async function writeAndSyncTmp(tmpPath: string, payload: string): Promise<void> {
    const tmpFile = await open(tmpPath, 'w', 0o600);
    try {
        await tmpFile.writeFile(payload, 'utf8');
        await tmpFile.sync();
    } finally {
        await tmpFile.close();
    }
}

async function fsyncDir(dir: string): Promise<void> {
    // Some platforms / filesystems do not allow opening directories for fsync.
    // Swallow errors — the rename itself is already atomic in the POSIX page cache;
    // parent-dir fsync is durability hardening only (best-effort on tmpfs/NFS).
    let dirFile;
    try {
        dirFile = await open(dir, 'r');
        await dirFile.sync();
    } catch {
        // ignore
    } finally {
        if (dirFile) {
            try { await dirFile.close(); } catch { /* ignore */ }
        }
    }
}

/**
 * Atomically write a JSON-serializable value to `targetPath`.
 *
 * @param targetPath  Absolute path to the target file
 * @param value       JSON-serializable value (pretty-printed with 2 spaces)
 */
export async function atomicWriteJson(targetPath: string, value: unknown): Promise<void> {
    const tmp = tmpPathFor(targetPath);
    const payload = JSON.stringify(value, null, 2);
    await writeAndSyncTmp(tmp, payload);
    await rename(tmp, targetPath);
    await fsyncDir(dirname(targetPath));
}

function isPidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function tryUnlink(path: string): Promise<void> {
    try {
        await unlink(path);
    } catch {
        // Best-effort; ignore failures
    }
}

/**
 * Best-effort cleanup of orphaned `<base>.tmp.<pid>` siblings whose pid is no longer alive.
 * Safe to call before or after a successful write; never touches the target file itself.
 */
export async function cleanOrphanTmpFiles(targetPath: string): Promise<void> {
    const dir = dirname(targetPath);
    const prefix = `${basename(targetPath)}.tmp.`;

    let entries: string[];
    try {
        entries = await readdir(dir);
    } catch {
        return;
    }

    for (const entry of entries) {
        if (!entry.startsWith(prefix)) continue;
        const pid = Number.parseInt(entry.slice(prefix.length), 10);
        if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) continue;
        if (isPidAlive(pid)) continue;
        await tryUnlink(join(dir, entry));
    }
}
