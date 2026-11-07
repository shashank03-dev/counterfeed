/** Tiny typed event emitter. Listeners are called synchronously; errors in one never stop the others. */
export class Emitter<E extends Record<string, unknown[]>> {
  private map = new Map<keyof E, Set<(...a: never[]) => void>>();

  on<K extends keyof E>(event: K, fn: (...args: E[K]) => void): () => void {
    let set = this.map.get(event);
    if (!set) this.map.set(event, (set = new Set()));
    set.add(fn as unknown as (...a: never[]) => void);
    return () => set.delete(fn as unknown as (...a: never[]) => void);
  }

  emit<K extends keyof E>(event: K, ...args: E[K]) {
    const set = this.map.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        (fn as unknown as (...a: E[K]) => void)(...args);
      } catch (err) {
        console.error(`[counterfeed] listener for "${String(event)}" failed`, err);
      }
    }
  }

  clear() {
    this.map.clear();
  }
}
