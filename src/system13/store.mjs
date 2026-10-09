/** Durable infrastructure, not additional game state. SQLite snapshots are append-only. */
import { DatabaseSync } from "node:sqlite";
import {
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  mkdirSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { JobsState, requireRule, RuleError } from "./schema.mjs";

export class JobsStore {
  #db;
  #file;
  #busy = false;
  constructor(filename = ":memory:") {
    this.#file = filename === ":memory:" ? null : resolve(filename);
    if (this.#file) mkdirSync(dirname(this.#file), { recursive: true });
    this.#db = new DatabaseSync(this.#file ?? ":memory:");
    this.#db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;",
    );
    this.#db.exec(`CREATE TABLE IF NOT EXISTS jobs13_snapshots (
      snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id TEXT NOT NULL, branch_id TEXT NOT NULL, state_json TEXT NOT NULL
    ); CREATE INDEX IF NOT EXISTS jobs13_branch ON jobs13_snapshots(world_id,branch_id,snapshot_id);`);
  }
  hold(action) {
    requireRule(!this.#busy, "RECOVERY_PENDING");
    this.#busy = true;
    let fd;
    const path = this.#file ? `${this.#file}.system13-lock` : null;
    try {
      if (path) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            fd = openSync(path, "wx");
            writeFileSync(fd, JSON.stringify({ pid: process.pid }));
            break;
          } catch (error) {
            if (error.code !== "EEXIST") throw error;
            let lock;
            try {
              lock = JSON.parse(readFileSync(path, "utf8"));
            } catch {
              throw new RuleError("RECOVERY_PENDING");
            }
            requireRule(
              Number.isSafeInteger(lock.pid) && lock.pid > 0,
              "RECOVERY_PENDING",
            );
            let dead = false;
            try {
              process.kill(lock.pid, 0);
            } catch (e) {
              dead = e.code === "ESRCH";
            }
            requireRule(dead, "RECOVERY_PENDING");
            try {
              unlinkSync(path);
            } catch (e) {
              if (e.code !== "ENOENT") throw e;
            }
          }
        }
        requireRule(fd !== undefined, "RECOVERY_PENDING");
      }
      return action();
    } finally {
      if (fd !== undefined) {
        closeSync(fd);
        unlinkSync(path);
      }
      this.#busy = false;
    }
  }
  exists(world, branch) {
    return !!this.#db
      .prepare(
        "SELECT 1 FROM jobs13_snapshots WHERE world_id=? AND branch_id=? LIMIT 1",
      )
      .get(world, branch);
  }
  load(world, branch) {
    const row = this.#db
      .prepare(
        "SELECT state_json FROM jobs13_snapshots WHERE world_id=? AND branch_id=? ORDER BY snapshot_id DESC LIMIT 1",
      )
      .get(world, branch);
    return row ? new JobsState(JSON.parse(row.state_json)) : new JobsState();
  }
  save(world, branch, state) {
    const snapshot = new JobsState(state.toJSON()).toJSON();
    this.#db
      .prepare(
        "INSERT INTO jobs13_snapshots(world_id,branch_id,state_json) VALUES (?,?,?)",
      )
      .run(world, branch, JSON.stringify(snapshot));
  }
  close() {
    this.#db.close();
  }
}
