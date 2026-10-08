// localStorage sarmalayıcı. Gizli pencerede ya da kapalı depolamada sessizce varsayılana döner.
const PREFIX = "mk:";

export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(PREFIX + key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* depolama yoksa ilerleme sadece bu oturumda tutulur */
    }
  },
};
