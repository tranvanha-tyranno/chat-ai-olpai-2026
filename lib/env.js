import { readFile } from "node:fs/promises";

export function parseEnv(text) {
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
    if (!match) continue;
    const quoted = match[2].match(/^(['"])(.*?)\1\s*(?:#.*)?$/);
    values.set(match[1], quoted ? quoted[2] : match[2].replace(/\s+#.*$/, "").trim());
  }
  return values;
}

export async function createEnvLoader(path, environment = process.env) {
  const inherited = new Set(Object.keys(environment));
  const owned = new Set();
  async function readValues() {
    try { return parseEnv(await readFile(path, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return new Map(); throw error; }
  }
  const initial = await readValues();
  let fileValues = initial;
  for (const [key, value] of initial) {
    if (!inherited.has(key)) { environment[key] = value; owned.add(key); }
  }
  return {
    apiKey(provider) {
      const name = provider === "groq" ? "GROQ_API_KEY" : "OPENROUTER_API_KEY";
      return fileValues.get(name)?.trim() || null;
    },
    async reloadCredentials() {
      const values = await readValues();
      fileValues = values;
      for (const key of ["GROQ_API_KEY", "OPENROUTER_API_KEY"]) {
        if (inherited.has(key)) continue;
        if (values.has(key)) { environment[key] = values.get(key); owned.add(key); }
        else if (owned.has(key)) { delete environment[key]; owned.delete(key); }
      }
    },
  };
}
