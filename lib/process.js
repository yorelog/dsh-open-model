/**
 * Child-process plumbing: executable discovery, bounded command execution,
 * liveness probes and the two-stage stop ladder.
 * @module @local/open-model/lib/process
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sleep } from './util.js';

/**
 * @param {number | null | undefined} pid
 * @returns {boolean}
 */
export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error !== null && typeof error === 'object' && error.code === 'EPERM';
  }
}

/**
 * @param {string} candidate
 * @returns {boolean}
 */
function isFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Find an executable on PATH (and optionally in extra directories), without
 * shelling out. Absolute paths are verified directly.
 * @param {string} command
 * @param {{ env?: NodeJS.ProcessEnv, extraDirs?: string[] }} [options]
 * @returns {string | null}
 */
export function resolveExecutable(command, options = {}) {
  if (typeof command !== 'string' || command.trim().length === 0) return null;
  const env = options.env ?? process.env;
  const direct = path.resolve(command);
  if (command.includes('/') || command.includes('\\')) {
    return isFile(direct) ? direct : null;
  }
  const names = process.platform === 'win32' && !/\.(exe|cmd|bat)$/iu.test(command)
    ? [`${command}.exe`, `${command}.cmd`, `${command}.bat`, command]
    : [command];
  const dirs = [];
  for (const dir of String(env.PATH ?? env.Path ?? '').split(path.delimiter)) {
    if (dir.trim().length > 0) dirs.push(dir.trim());
  }
  for (const dir of options.extraDirs ?? []) {
    if (typeof dir === 'string' && dir.trim().length > 0) dirs.push(dir.trim());
  }
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Last `max` characters of a command's combined output.
 * @param {{ stdout?: string, stderr?: string }} result
 * @param {number} [max]
 * @returns {string}
 */
export function outputTail(result, max = 4_000) {
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return text.length <= max ? text : `…${text.slice(-max)}`;
}

/**
 * Run one command to completion with bounded output, a timeout and abort
 * support.
 * @param {readonly string[]} argv
 * @param {{
 *   cwd?: string,
 *   env?: NodeJS.ProcessEnv,
 *   timeoutMs?: number,
 *   signal?: AbortSignal,
 *   input?: string,
 *   maxOutputBytes?: number
 * }} [options]
 * @returns {Promise<{ code: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string, timedOut: boolean, aborted: boolean, spawnError: Error | null, durationMs: number }>}
 */
export function runCommand(argv, options = {}) {
  const startedAt = Date.now();
  const maxBytes = options.maxOutputBytes ?? 64 * 1024;
  return new Promise((resolve) => {
    /** @type {import('node:child_process').ChildProcess} */
    let child;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let spawnError = null;

    const append = (target, chunk) => {
      const text = `${target}${chunk.toString('utf8')}`;
      return text.length > maxBytes ? text.slice(-maxBytes) : text;
    };

    try {
      child = spawn(argv[0], argv.slice(1), {
        cwd: options.cwd,
        env: options.env ?? process.env,
        stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
        windowsHide: true
      });
    } catch (error) {
      resolve({
        code: null,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        aborted: false,
        spawnError: error instanceof Error ? error : new Error(String(error)),
        durationMs: Date.now() - startedAt
      });
      return;
    }

    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (options.signal !== undefined) options.signal.removeEventListener('abort', onAbort);
      resolve({
        code,
        signal,
        stdout,
        stderr,
        timedOut,
        aborted,
        spawnError,
        durationMs: Date.now() - startedAt
      });
    };

    const onAbort = () => {
      aborted = true;
      killChild(child);
    };

    const timer = options.timeoutMs !== undefined && options.timeoutMs > 0
      ? setTimeout(() => {
        timedOut = true;
        killChild(child);
      }, options.timeoutMs)
      : undefined;

    if (options.signal !== undefined) {
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout?.on('data', (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.on('error', (error) => {
      spawnError = error;
      finish(null, null);
    });
    child.on('close', (code, signal) => {
      finish(code, signal);
    });
    if (options.input !== undefined) {
      child.stdin?.end(options.input);
    }
  });
}

/**
 * Ask a child to stop, escalating to a forced kill after `graceMs`.
 * On Windows there is no SIGTERM for console processes, so `taskkill /T`
 * without `/F` is the graceful tier and `/F` the forced one.
 * @param {import('node:child_process').ChildProcess | null} child
 * @param {number} pid
 * @param {number} graceMs
 * @returns {Promise<{ graceful: boolean, forced: boolean }>}
 */
export async function stopProcess(child, pid, graceMs) {
  if (!isProcessAlive(pid)) {
    if (child !== null) child.removeAllListeners('exit');
    return { graceful: true, forced: false };
  }
  /** @type {Promise<void>} */
  const exited = new Promise((resolve) => {
    if (child === null) {
      resolve();
      return;
    }
    child.once('exit', () => resolve());
  });
  if (process.platform === 'win32') {
    await runCommand(['taskkill', '/PID', String(pid), '/T'], { timeoutMs: 15_000 });
  } else if (child !== null) {
    try {
      child.kill('SIGTERM');
    } catch {
      // The process may have exited between the liveness probe and the signal.
    }
  } else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  }
  const graceful = await Promise.race([
    exited.then(() => true),
    sleep(graceMs).then(() => !isProcessAlive(pid))
  ]);
  if (graceful && !isProcessAlive(pid)) return { graceful: true, forced: false };

  if (process.platform === 'win32') {
    await runCommand(['taskkill', '/PID', String(pid), '/T', '/F'], { timeoutMs: 15_000 });
  } else {
    try {
      if (child !== null) child.kill('SIGKILL');
      else process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!isProcessAlive(pid)) break;
    await sleep(100);
  }
  return { graceful: false, forced: true };
}

/**
 * Best-effort, synchronous-ish tree kill used by teardown paths that cannot
 * await (Cordis disposers can be async, but a hung child must never survive a
 * reload).
 * @param {import('node:child_process').ChildProcess | null} child
 * @param {number} pid
 */
export function killChild(child) {
  if (child === null) return;
  try {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(child.pid ?? 0), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      });
      killer.unref();
    } else {
      child.kill('SIGKILL');
    }
  } catch {
    // Nothing to do: the process is already gone.
  }
}

/**
 * Find a free TCP port on the loopback interface.
 * @param {string} host
 * @returns {Promise<number>}
 */
export async function findFreePort(host) {
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Human-facing platform label.
 * @returns {string}
 */
export function platformLabel() {
  const arch = process.arch;
  if (process.platform === 'win32') return `Windows (${arch})`;
  if (process.platform === 'darwin') return `macOS (${arch})`;
  return `${process.platform} (${arch})`;
}

/**
 * Whether this host is Apple Silicon.
 * @returns {boolean}
 */
export function isAppleSilicon() {
  return process.platform === 'darwin' && process.arch === 'arm64';
}

/** @returns {string} */
export function homeDir() {
  return os.homedir();
}
