/**
 * @navora/daemon - Lockfile Management
 * Single-instance enforcement via PID file
 */

import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";

/** Lockfile configuration */
export interface LockfileConfig {
  /** Directory to store lockfile */
  lockDir?: string;
  /** Lockfile filename */
  lockFilename?: string;
}

/** Lockfile data stored in the file */
export interface LockfileData {
  /** Process ID */
  pid: number;
  /** Hostname */
  hostname: string;
  /** Timestamp when lock was acquired */
  timestamp: number;
  /** Working directory */
  cwd: string;
}

/**
 * LockfileManager - Manages the daemon lockfile for single-instance enforcement
 */
export class LockfileManager {
  private lockPath: string;
  private lockData: LockfileData | null = null;

  constructor(config: LockfileConfig = {}) {
    const lockDir = config.lockDir ?? path.join(os.tmpdir(), "ai-browser-runtime");
    const lockFilename = config.lockFilename ?? "daemon.pid";
    this.lockPath = path.join(lockDir, lockFilename);
  }

  /**
   * Get the lockfile path
   */
  getLockPath(): string {
    return this.lockPath;
  }

  /**
   * Try to acquire the lockfile
   * Returns the lock data if successful, null if already locked
   */
  async acquire(): Promise<LockfileData | null> {
    // Ensure lock directory exists
    const lockDir = path.dirname(this.lockPath);
    await fs.mkdir(lockDir, { recursive: true });

    // Try to read existing lockfile
    try {
      const content = await fs.readFile(this.lockPath, "utf8");
      const data = JSON.parse(content) as LockfileData;

      // Check if the process is still running
      if (await this.isProcessRunning(data.pid)) {
        return null; // Lock is held by another process
      }

      // Process is dead, stale lockfile - remove it
      await fs.unlink(this.lockPath);
    } catch {
      // Lockfile doesn't exist, that's fine
    }

    // Create new lockfile
    this.lockData = {
      pid: process.pid,
      hostname: os.hostname(),
      timestamp: Date.now(),
      cwd: process.cwd(),
    };

    await fs.writeFile(this.lockPath, JSON.stringify(this.lockData, null, 2));
    return this.lockData;
  }

  /**
   * Check if a process with given PID is still running
   */
  private async isProcessRunning(pid: number): Promise<boolean> {
    try {
      if (process.platform === "win32") {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { execSync } = require("child_process");
        try {
          // tasklist exits 0 even when the PID doesn't exist — must check output
          const out: string = execSync(`tasklist /FI "PID eq ${pid}" /NH`, { stdio: "pipe" }).toString();
          return out.includes(String(pid));
        } catch {
          return false;
        }
      } else {
        // Unix - signal 0 doesn't actually send anything
        process.kill(pid, 0);
        return true;
      }
    } catch {
      return false; // Process doesn't exist or no permission
    }
  }

  /**
   * Release the lockfile
   */
  async release(): Promise<void> {
    if (!this.lockData) {
      return;
    }

    // Only release if we own the lock
    try {
      const content = await fs.readFile(this.lockPath, "utf8");
      const data = JSON.parse(content) as LockfileData;
      if (data.pid === this.lockData.pid) {
        await fs.unlink(this.lockPath);
      }
    } catch {
      // Ignore errors
    }

    this.lockData = null;
  }

  /**
   * Read the current lockfile data
   */
  async read(): Promise<LockfileData | null> {
    try {
      const content = await fs.readFile(this.lockPath, "utf8");
      return JSON.parse(content) as LockfileData;
    } catch {
      return null;
    }
  }

  /**
   * Check if the daemon is already running
   */
  async isLocked(): Promise<boolean> {
    const data = await this.read();
    if (!data) {
      return false;
    }
    return await this.isProcessRunning(data.pid);
  }
}

/**
 * Create a new LockfileManager instance
 */
export function createLockfileManager(config?: LockfileConfig): LockfileManager {
  return new LockfileManager(config);
}