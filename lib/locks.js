/**
 * In-memory keyed mutex.
 *
 * One Host process owns every runtime this plugin starts, so a process-local
 * mutex is sufficient to make load/unload/registry writes serial. It also
 * keeps a reload honest: a second concurrent tool call waits for the first
 * instead of spawning the same model twice.
 * @module @local/open-model/lib/locks
 */

export class KeyedMutex {
  /** @type {Map<string, Promise<void>>} */
  #tails = new Map();

  /**
   * Run `task` while holding the lock for `key`.
   * @template T
   * @param {string} key
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
  async run(key, task) {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    /** @type {() => void} */
    let release = () => {};
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.#tails.set(key, tail);
    await previous.catch(() => {});
    try {
      return await task();
    } finally {
      release();
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    }
  }

  /** @returns {number} how many keys currently hold or await a lock */
  get size() {
    return this.#tails.size;
  }
}
