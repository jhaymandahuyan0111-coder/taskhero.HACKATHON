/* Keep the existing synchronous database API on Cloudflare's durable SQLite. */
module.exports = class CloudflareDatabase {
  constructor() {
    if (!this.storage) throw new Error("TaskHero SQLite storage is unavailable");
  }

  get storage() { return globalThis.__taskheroStorage; }

  pragma(sql) {
    if (/^(journal_mode|foreign_keys)\s*=/i.test(sql)) return [];
    return this.storage.sql.exec("PRAGMA " + sql).toArray();
  }

  exec(sql) {
    this.storage.sql.exec(sql).toArray();
    return this;
  }

  prepare(sql) {
    const execute = (args) => {
      let bindings = args;
      let query = sql;
      if (args.length === 1 && args[0] && typeof args[0] === "object" && !Array.isArray(args[0])) {
        const values = args[0];
        bindings = [];
        query = sql.replace(/'(?:''|[^'])*'|[@:$]([A-Za-z_][A-Za-z0-9_]*)/g, (token, name) => {
          if (!name) return token;
          if (!Object.hasOwn(values, name)) throw new Error("Missing SQL parameter " + name);
          bindings.push(values[name]);
          return "?";
        });
      } else if (args.length === 1 && Array.isArray(args[0])) {
        bindings = args[0];
      }
      return this.storage.sql.exec(query, ...bindings);
    };
    return {
      all: (...args) => execute(args).toArray(),
      get: (...args) => execute(args).toArray()[0],
      run: (...args) => {
        execute(args).toArray();
        const result = this.storage.sql.exec(
          "SELECT changes() AS changes, last_insert_rowid() AS lastInsertRowid"
        ).one();
        return result;
      },
    };
  }

  transaction(callback) {
    return (...args) => this.storage.transactionSync(() => callback(...args));
  }
};
