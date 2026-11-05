import { afterEach, describe, expect, it } from "vitest";
import { newPassword, registerSchema } from "@slotix/validation";
import { arrivedOverPlainHttp } from "../src/app/app";
import { parseEnv, productionWarnings } from "../src/config/env";
import { captureSecurityLog, emailFingerprint, logSecurityEvent, SUSPICIOUS_THRESHOLD } from "../src/shared/securityLog";
import { demoSeedAllowed } from "../prisma/seedGuard";
// The web dashboard's real CSRF guard (apps/web/lib/csrf.ts): a plain module, no Next imports.
import { isCrossSiteMutation } from "../../web/lib/csrf";

afterEach(() => captureSecurityLog(null));

function captured() {
  const lines: string[] = [];
  captureSecurityLog((line) => lines.push(line));
  return { lines, events: () => lines.map((line) => JSON.parse(line.replace("[security] ", "")) as Record<string, unknown>) };
}

describe("S-01: registo de atividade suspeita", () => {
  it("cada evento é uma linha JSON com o prefixo [security], sem o email em claro", () => {
    const log = captured();
    logSecurityEvent("login_failed", { ip: "203.0.113.7", email: "Ana@Example.test", path: "/api/v1/auth/login" });
    expect(log.lines[0].startsWith("[security] ")).toBe(true);
    const [event] = log.events();
    expect(event).toMatchObject({ event: "login_failed", ip: "203.0.113.7", account: emailFingerprint("ana@example.test") });
    expect(log.lines[0]).not.toContain("Ana@Example.test");
    expect(log.lines[0].toLowerCase()).not.toContain("ana@example.test");
  });

  it("muitas falhas do mesmo IP geram UM alerta suspicious_activity por janela", () => {
    const log = captured();
    for (let i = 0; i < SUSPICIOUS_THRESHOLD * 2; i++) logSecurityEvent("token_rejected", { ip: "198.51.100.1" });
    const alerts = log.events().filter((event) => event.event === "suspicious_activity");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ ip: "198.51.100.1", count: SUSPICIOUS_THRESHOLD });
  });

  it("um ataque espalhado por vários IPs contra a mesma conta também gera alerta", () => {
    const log = captured();
    for (let i = 0; i < SUSPICIOUS_THRESHOLD; i++) logSecurityEvent("login_failed", { ip: `192.0.2.${i}`, email: "vitima@example.test" });
    expect(log.events().filter((event) => event.event === "suspicious_activity")).toHaveLength(1);
  });

  it("eventos de auditoria (password alterada) não contam como falhas", () => {
    const log = captured();
    for (let i = 0; i < SUSPICIOUS_THRESHOLD * 2; i++) logSecurityEvent("password_changed", { userId: "u1" });
    expect(log.events().some((event) => event.event === "suspicious_activity")).toBe(false);
  });
});

describe("S-02: HTTPS obrigatório em produção", () => {
  const request = (proto: string | undefined, path = "/api/v1/auth/login") => ({
    path,
    get: (name: string) => (name.toLowerCase() === "x-forwarded-proto" ? proto : undefined),
  });

  it("recusa pedidos que chegaram por http ao proxy", () => {
    expect(arrivedOverPlainHttp(request("http") as never, "production")).toBe(true);
    expect(arrivedOverPlainHttp(request("HTTP, https") as never, "production")).toBe(true);
  });

  it("aceita https, pedidos internos sem o cabeçalho, o /health e qualquer pedido fora de produção", () => {
    expect(arrivedOverPlainHttp(request("https") as never, "production")).toBe(false);
    expect(arrivedOverPlainHttp(request(undefined) as never, "production")).toBe(false);
    expect(arrivedOverPlainHttp(request("http", "/health") as never, "production")).toBe(false);
    expect(arrivedOverPlainHttp(request("http") as never, "development")).toBe(false);
  });
});

describe("S-03: seed das contas de demonstração", () => {
  it("nunca corre em produção nem contra uma base remota", () => {
    expect(demoSeedAllowed({ NODE_ENV: "production", DATABASE_URL: "postgresql://u:p@localhost:5432/x" })).toBe(false);
    expect(demoSeedAllowed({ NODE_ENV: "development", DATABASE_URL: "postgresql://u:p@ep-x.us-east-2.aws.neon.tech/neondb?sslmode=require" })).toBe(false);
    expect(demoSeedAllowed({ NODE_ENV: "development", DATABASE_URL: "lixo" })).toBe(false);
  });

  it("corre numa base local (incluindo a do docker-compose) ou quando pedido explicitamente", () => {
    expect(demoSeedAllowed({ NODE_ENV: "development", DATABASE_URL: "postgresql://agenda:agenda@db:5432/agenda" })).toBe(true);
    expect(demoSeedAllowed({ DATABASE_URL: "postgresql://u:p@127.0.0.1:5433/x" })).toBe(true);
    expect(demoSeedAllowed({ NODE_ENV: "production", ALLOW_DEMO_SEED: "true", DATABASE_URL: "postgresql://u:p@remote.example/x" })).toBe(true);
  });
});

describe("S-04: avisos de configuração em produção", () => {
  const strong = { access: "a".repeat(64), refresh: "b".repeat(64) };
  function warnings(extra: Record<string, string>) {
    const parsed = parseEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://u:p@db.example.com/app?sslmode=require",
      JWT_ACCESS_SECRET: strong.access,
      JWT_REFRESH_SECRET: strong.refresh,
      WEB_URL: "https://painel.example",
      ...extra,
    });
    if (!parsed.success) throw new Error("env inválido no teste");
    return productionWarnings(parsed.data);
  }

  it("uma configuração forte não gera avisos", () => {
    expect(warnings({})).toEqual([]);
  });

  it("avisa de segredos de exemplo, origens http, base remota sem SSL e Swagger público", () => {
    expect(warnings({ JWT_ACCESS_SECRET: "dev-only-access-secret-change-me-0000000000" }).join(" ")).toContain("valor de exemplo");
    expect(warnings({ CORS_ORIGINS: "http://app.example" }).join(" ")).toContain("http://app.example");
    expect(warnings({ DATABASE_URL: "postgresql://u:p@db.example.com/app" }).join(" ")).toContain("sslmode");
    expect(warnings({ ENABLE_API_DOCS: "true" }).join(" ")).toContain("/api/v1/docs");
  });

  it("fora de produção não avisa", () => {
    const parsed = parseEnv({ NODE_ENV: "development", DATABASE_URL: "postgresql://u:p@x/y", JWT_ACCESS_SECRET: "a", JWT_REFRESH_SECRET: "a" });
    expect(parsed.success && productionWarnings(parsed.data)).toEqual([]);
  });
});

describe("S-05: CSRF no painel web", () => {
  const headers = (values: Record<string, string>) => new Headers({ host: "painel.example", ...values });

  it("recusa alterações vindas de outro site", () => {
    expect(isCrossSiteMutation("POST", headers({ "sec-fetch-site": "cross-site" }))).toBe(true);
    expect(isCrossSiteMutation("DELETE", headers({ "sec-fetch-site": "same-site" }))).toBe(true);
    expect(isCrossSiteMutation("PUT", headers({ origin: "https://atacante.example" }))).toBe(true);
    expect(isCrossSiteMutation("PATCH", headers({ origin: "null" }))).toBe(true);
  });

  it("aceita pedidos do próprio painel, leituras e clientes que não são browsers", () => {
    expect(isCrossSiteMutation("POST", headers({ "sec-fetch-site": "same-origin", origin: "https://painel.example" }))).toBe(false);
    expect(isCrossSiteMutation("POST", headers({ origin: "https://painel.example" }))).toBe(false);
    expect(isCrossSiteMutation("GET", headers({ "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isCrossSiteMutation("POST", headers({}))).toBe(false);
  });
});

describe("S-06: passwords comuns", () => {
  it("recusa as passwords mais usadas, em qualquer capitalização", () => {
    for (const weak of ["password123", "12345678", "Senha123", "QWERTYUIOP"]) expect(newPassword.safeParse(weak).success).toBe(false);
    expect(registerSchema.safeParse({ name: "Ana", email: "ana@example.test", password: "password123" }).success).toBe(false);
  });

  it("aceita uma password razoável", () => {
    expect(newPassword.safeParse("Cavalo-Bateria-42").success).toBe(true);
  });
});
