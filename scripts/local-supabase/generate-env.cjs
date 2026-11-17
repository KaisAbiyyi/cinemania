"use strict";
// Generates fresh synthetic credentials for this disposable local stack only.
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const target = path.resolve(__dirname, "../../supabase/.env.local");
if (fs.existsSync(target)) throw new Error("Refusing to replace existing local credentials");
const secret = crypto.randomBytes(32).toString("hex");
const encode = (x) => Buffer.from(JSON.stringify(x)).toString("base64url");
function jwt(role) {
  const body = [encode({ alg: "HS256", typ: "JWT" }), encode({ role, iss: "supabase", iat: 1700000000, exp: 4102444800 })].join(".");
  return body + "." + crypto.createHmac("sha256", secret).update(body).digest("base64url");
}
const env = {
  POSTGRES_PASSWORD: crypto.randomBytes(24).toString("hex"),
  JWT_SECRET: secret,
  SECRET_KEY_BASE: crypto.randomBytes(48).toString("hex"),
  ANON_KEY: jwt("anon"),
  SERVICE_ROLE_KEY: jwt("service_role"),
};
fs.writeFileSync(target, Object.entries(env).map(([k,v]) => k + "=" + v).join("\n") + "\n", { flag: "wx", mode: 0o600 });
console.log("Created local-only credentials in ignored file; values withheld.");
