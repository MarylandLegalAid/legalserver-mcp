class PromiseCache {
  constructor() {
    this.entries = new Map();
  }

  getOrCreate(key, ttlMs, factory) {
    const now = Date.now();
    const cached = this.entries.get(key);
    if (cached) {
      if (cached.pending) {
        return cached.pending;
      }

      if (cached.expiresAt > now) {
        return Promise.resolve(cached.value);
      }

      this.entries.delete(key);
    }

    const pending = Promise.resolve()
      .then(factory)
      .then((value) => {
        if (ttlMs > 0) {
          this.entries.set(key, {
            expiresAt: Date.now() + ttlMs,
            pending: null,
            value,
          });
        } else {
          this.entries.delete(key);
        }

        return value;
      })
      .catch((error) => {
        this.entries.delete(key);
        throw error;
      });

    this.entries.set(key, {
      expiresAt: now + ttlMs,
      pending,
      value: null,
    });

    return pending;
  }
}

module.exports = {
  PromiseCache,
};
