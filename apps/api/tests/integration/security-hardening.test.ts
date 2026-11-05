import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetRateLimits } from "../../src/shared/middleware/rateLimit";
import { captureSecurityLog, emailFingerprint } from "../../src/shared/securityLog";
import { app, auth, createBusinessFixture, createUser, PASSWORD, resetDatabase } from "./helpers";

let lines: string[] = [];
const events = () => lines.map((line) => JSON.parse(line.replace("[security] ", "")) as Record<string, unknown>);

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
  lines = [];
  captureSecurityLog((line) => lines.push(line));
});

afterEach(() => captureSecurityLog(null));

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe("S-01: as recusas da API ficam registadas", () => {
  it("um login falhado é registado com o IP e a conta (em hash), nunca com a password", async () => {
    const { user } = await createUser("CUSTOMER");
    const response = await request(app).post("/api/v1/auth/login").send({ email: user.email, password: "Errada-Mesmo-1" });
    expect(response.status).toBe(401);

    const [event] = events().filter((e) => e.event === "login_failed");
    expect(event).toMatchObject({ path: "/api/v1/auth/login", account: emailFingerprint(user.email), reason: "AUTHENTICATION_ERROR" });
    expect(event.ip).toBeTruthy();
    expect(lines.join("\n")).not.toContain("Errada-Mesmo-1");
    expect(lines.join("\n")).not.toContain(user.email);
  });

  it("o acesso aos dados de outro negócio é registado como access_denied com o utilizador", async () => {
    const a = await createBusinessFixture("A");
    const b = await createBusinessFixture("B");
    const response = await request(app).get(`/api/v1/businesses/${b.business.id}/financials`).set(auth(a.owner.token));
    expect(response.status).toBe(403);
    expect(events().find((e) => e.event === "access_denied")).toMatchObject({ userId: a.owner.user.id, method: "GET" });
  });

  it("um token falso e um limite atingido também ficam registados", async () => {
    await request(app).get("/api/v1/auth/me").set(auth("nao.e.um-token"));
    expect(events().some((e) => e.event === "token_rejected")).toBe(true);

    const { user } = await createUser("CUSTOMER");
    for (let i = 0; i < 11; i++) await request(app).post("/api/v1/auth/login").send({ email: user.email, password: "Errada-Mesmo-1" });
    expect(events().some((e) => e.event === "rate_limited")).toBe(true);
  });

  it("mudar a password e terminar todas as sessões deixam rasto de auditoria", async () => {
    const { user, token } = await createUser("OWNER");
    const change = await request(app).post("/api/v1/users/me/password").set(auth(token)).send({ currentPassword: PASSWORD, newPassword: "Cavalo-Bateria-42" });
    expect(change.status).toBe(200);
    expect(events().find((e) => e.event === "password_changed")).toMatchObject({ userId: user.id });

    await request(app).post("/api/v1/auth/logout-all").set(auth(change.body.data.accessToken));
    expect(events().find((e) => e.event === "all_sessions_ended")).toMatchObject({ userId: user.id });
  });
});

describe("S-06: passwords comuns recusadas no servidor", () => {
  it("no registo e na mudança de password", async () => {
    const register = await request(app).post("/api/v1/auth/register").send({ name: "Ana", email: "ana@example.test", password: "password123" });
    expect(register.status).toBe(400);

    const { token } = await createUser("OWNER");
    const change = await request(app).post("/api/v1/users/me/password").set(auth(token)).send({ currentPassword: PASSWORD, newPassword: "12345678" });
    expect(change.status).toBe(400);
  });
});

describe("S-07: uploads", () => {
  it("recusa mais de um ficheiro por pedido", async () => {
    const { token } = await createUser("CUSTOMER");
    const response = await request(app)
      .post("/api/v1/users/me/avatar")
      .set(auth(token))
      .attach("file", PNG, { filename: "a.png", contentType: "image/png" })
      .attach("file", PNG, { filename: "b.png", contentType: "image/png" });
    expect(response.status).toBe(400);
  });

  it("recusa um ficheiro que diz ser imagem mas não é", async () => {
    const { token } = await createUser("CUSTOMER");
    const html = Buffer.from("<script>alert(1)</script>");
    const response = await request(app).post("/api/v1/users/me/avatar").set(auth(token)).attach("file", html, { filename: "x.png", contentType: "image/png" });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("IMAGE_CONTENT_INVALID");
  });

  it("recusa tipos de ficheiro fora da lista", async () => {
    const { token } = await createUser("CUSTOMER");
    const response = await request(app).post("/api/v1/users/me/avatar").set(auth(token)).attach("file", Buffer.from("%PDF-1.4"), { filename: "x.pdf", contentType: "application/pdf" });
    expect(response.status).toBe(400);
  });
});

describe("S-08: cabeçalhos de segurança", () => {
  it("as respostas da API não ficam em cache e trazem os cabeçalhos de proteção", async () => {
    const { token } = await createUser("CUSTOMER");
    const response = await request(app).get("/api/v1/auth/me").set(auth(token));
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("CORS não autoriza uma origem desconhecida", async () => {
    const response = await request(app).get("/health").set("Origin", "https://atacante.example");
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
