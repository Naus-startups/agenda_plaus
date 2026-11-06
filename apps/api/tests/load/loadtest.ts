/*
 * Teste de carga: N clientes da app ao mesmo tempo, cada um com o percurso completo —
 * cadastro, login, /auth/me, espaço, serviços, profissionais, horários livres, marcação e
 * lista das suas marcações.
 *
 *   npm run loadtest --workspace apps/api                     # 20, 100 e 200 clientes
 *   npm run loadtest --workspace apps/api -- --users 50,500 --professionals 3
 *
 * Opções: --users (lista separada por vírgulas), --professionals (por omissão 1: o pior caso,
 * todos a disputar a mesma agenda), --days (dias de agenda que os clientes procuram), --port.
 *
 * Segurança: o script arranca a sua própria API e só a deixa ligar-se a uma base local e
 * descartável (a dos testes de integração, ou LOADTEST_DATABASE_URL), que esvazia antes de
 * começar. O .env real nunca é lido, e não há forma de apontar o teste a outra API: um URL
 * remoto, do Neon ou cujo nome não contenha "test" é recusado antes de qualquer ligação.
 * Se a porta já estiver ocupada, o teste não começa; a API que arranca (e só essa) é
 * terminada no fim, num erro ou numa interrupção (Ctrl+C).
 *
 * Termina com código 1 se houver erros 5xx, timeouts, falhas de rede ou marcações sobrepostas.
 */
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { createServer } from "node:net";
import path from "node:path";
import { TEST_DATABASE_URL } from "../../vitest.shared";
import { assertLocalTestDatabase } from "../integration/dbGuard";

const API_DIR = path.resolve(__dirname, "../..");
const PASSWORD = "Password123!";

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const LEVELS = option("users", "20,100,200").split(",").map(Number);
const PROFESSIONALS = Number(option("professionals", "1"));
const DAYS = Number(option("days", "3"));
const PORT = Number(option("port", "3999"));
if (LEVELS.some((n) => !Number.isInteger(n) || n < 1) || !(PROFESSIONALS >= 1) || !(DAYS >= 1)) {
  throw new Error("Uso: --users 20,100,200 --professionals 1 --days 3");
}

const DATABASE_URL = process.env.LOADTEST_DATABASE_URL ?? TEST_DATABASE_URL;
assertLocalTestDatabase(DATABASE_URL);
if (/neon/i.test(DATABASE_URL)) throw new Error("Recusado: o teste de carga nunca corre contra o Neon.");

const PROXY_SECRET = randomBytes(32).toString("hex");
// Tudo o que a API lê vem daqui. DIRECT_URL também: o prisma.config.ts prefere-o ao
// DATABASE_URL, e um DIRECT_URL de produção herdado da shell levaria lá as migrações.
const apiEnv: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  DOTENV_CONFIG_PATH: ".env.loadtest-nao-existe",
  NODE_ENV: "test",
  PORT: String(PORT),
  DATABASE_URL,
  DIRECT_URL: DATABASE_URL,
  JWT_ACCESS_SECRET: randomBytes(32).toString("hex"),
  JWT_REFRESH_SECRET: randomBytes(32).toString("hex"),
  WEB_URL: "http://localhost:3001",
  APP_TIMEZONE: "Africa/Luanda",
  // Cada cliente simulado chega com o seu IP, como telemóveis diferentes (ver internalProxy.ts),
  // para os limites por IP contarem por pessoa e não por esta máquina.
  INTERNAL_PROXY_SECRET: PROXY_SECRET,
  SUPABASE_URL: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
};
const BASE = `http://127.0.0.1:${PORT}/api/v1`;

// ---------------------------------------------------------------- preparação

async function prepareDatabase() {
  execSync("npx prisma migrate deploy", { cwd: API_DIR, env: apiEnv, stdio: "ignore" });
  Object.assign(process.env, apiEnv);
  const { prisma } = await import("../../src/config/database.js");

  assertLocalTestDatabase(process.env.DATABASE_URL);
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t: { tablename: string }) => `"public"."${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  }

  // Ninguém entra com estas contas: o hash só precisa de existir.
  const passwordHash = "$2b$10$loadtestloadtestloadteuOq8h2Gn2Wb7H9k4tS7p1n5m3q2r1s0";
  const owner = await prisma.user.create({ data: { email: "owner@loadtest.test", name: "Dono Carga", passwordHash, role: "OWNER" } });
  const business = await prisma.business.create({ data: { ownerId: owner.id, name: "Espaço Carga" } });
  for (let i = 0; i < PROFESSIONALS; i++) {
    const user = await prisma.user.create({ data: { email: `pro-${i}@loadtest.test`, name: `Profissional ${i}`, passwordHash, role: "EMPLOYEE" } });
    await prisma.professional.create({ data: { businessId: business.id, userId: user.id } });
  }
  await prisma.service.create({ data: { businessId: business.id, name: "Corte", price: 5000, duration: 30 } });
  // 08:00–20:00 todos os dias: 24 horários de 30 min por profissional e por dia.
  await prisma.businessHours.createMany({
    data: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ businessId: business.id, dayOfWeek, startMinute: 480, endMinute: 1200 })),
  });
  return prisma;
}

// ---------------------------------------------------------------- API do teste

const serverErrors: string[] = [];
let api: ChildProcess | undefined;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const running = (child: ChildProcess) => child.exitCode === null && child.signalCode === null;

// Se a porta já estiver ocupada (uma API deixada por outra execução, ou outro programa), o
// teste mediria esse processo e não o seu: pára antes de tocar na base de dados.
function assertPortFree(): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (error: NodeJS.ErrnoException) => {
      reject(
        error.code === "EADDRINUSE"
          ? new Error(`A porta ${PORT} já está ocupada por outro processo. Termine-o ou use --port <outra>: o teste não reutiliza uma API que não arrancou.`)
          : error,
      );
    });
    // Sem host, como o app.listen da API: apanha também quem só escuta em 127.0.0.1.
    probe.listen(PORT, () => probe.close(() => resolve()));
  });
}

// O próprio node (sem os intermediários npx/tsx, que ao serem terminados deixavam o
// servidor a correr), num grupo de processos só seu: stopApi termina esse grupo e nada mais.
async function startApi(): Promise<void> {
  const child = spawn(process.execPath, ["--import", "tsx", "src/app/server.ts"], {
    cwd: API_DIR,
    env: apiEnv,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  api = child;

  // Os dois canais são lidos até ao fim: um pipe cheio e por ler bloquearia a API.
  let ready = false;
  child.stdout!.on("data", (chunk: Buffer) => {
    if (chunk.toString().includes(`a correr em http://localhost:${PORT}`)) ready = true;
  });
  child.stderr!.on("data", (chunk: Buffer) => {
    for (const code of chunk.toString().match(/code: '(P\d{4})'|Error: [^\n]{0,120}/g) ?? []) serverErrors.push(code);
  });

  // Pronta quando ESTE processo diz que abriu a porta e responde; nunca só porque algo
  // na porta respondeu.
  for (let i = 0; i < 120; i++) {
    if (!running(child)) throw new Error(`A API do teste terminou ao arrancar (${serverErrors.at(-1) ?? `código ${child.exitCode}`}).`);
    if (ready && (await fetch(`http://127.0.0.1:${PORT}/health`).then((r) => r.ok).catch(() => false))) return;
    await sleep(250);
  }
  throw new Error(`A API do teste não respondeu na porta ${PORT}.`);
}

function signalApiGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

// SIGTERM ao grupo; se em 5 s não terminar, SIGKILL. Pode ser chamada mais do que uma vez.
async function stopApi(): Promise<void> {
  const child = api;
  if (!child?.pid) return;
  if (running(child)) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    signalApiGroup(child.pid, "SIGTERM");
    await Promise.race([exited, sleep(5000)]);
    if (running(child)) {
      signalApiGroup(child.pid, "SIGKILL");
      await exited;
    }
  }
  // Algum processo que a API tenha lançado e ainda reste no grupo dela.
  signalApiGroup(child.pid, "SIGKILL");
  api = undefined;
}

// Último recurso, síncrono, para saídas que não passam pelo finally de main().
process.on("exit", () => {
  if (api?.pid && running(api)) signalApiGroup(api.pid, "SIGKILL");
});

let stopping = false;
async function abort(code: number, reason?: unknown): Promise<void> {
  if (stopping) return;
  stopping = true;
  if (reason) console.error(reason instanceof Error ? reason.message : reason);
  await stopApi().catch(() => undefined);
  process.exit(code);
}
process.on("SIGINT", () => void abort(130, "\nInterrompido: a terminar a API do teste."));
process.on("SIGTERM", () => void abort(143));
process.on("SIGHUP", () => void abort(129));
process.on("uncaughtException", (error) => void abort(1, error));
process.on("unhandledRejection", (error) => void abort(1, error));
// O npm não reencaminha o SIGTERM: se quem lançou o teste desaparecer, o teste também pára,
// em vez de continuar sozinho em segundo plano.
const launcher = process.ppid;
setInterval(() => {
  if (process.ppid !== launcher) void abort(143, "O processo que lançou o teste terminou: a parar a API do teste.");
}, 500).unref();

// ---------------------------------------------------------------- clientes simulados

type Status = number | "TIMEOUT" | "NETWORK";
interface RouteStats {
  latencies: number[];
  codes: Record<string, number>;
}
let stats = new Map<string, RouteStats>();
let failures: string[] = [];

function proxyHeaders(user: number): Record<string, string> {
  const ip = `10.${(user >> 16) & 255}.${(user >> 8) & 255}.${user & 255}`;
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = createHmac("sha256", PROXY_SECRET).update(`agenda-proxy-v1\n${ts}\n${ip}`).digest("hex");
  return { "x-agenda-proxy-ts": ts, "x-agenda-client-ip": ip, "x-agenda-proxy-sig": sig };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(user: number, route: string, path: string, options: { body?: unknown; token?: string } = {}): Promise<{ status: Status; data: any }> {
  const started = performance.now();
  let status: Status;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any = null;
  try {
    const response = await fetch(BASE + path, {
      method: route.split(" ")[0],
      headers: {
        "content-type": "application/json",
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...proxyHeaders(user),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    status = response.status;
    json = await response.json().catch(() => null);
  } catch (error) {
    status = (error as Error).name === "TimeoutError" ? "TIMEOUT" : "NETWORK";
  }
  const entry = stats.get(route) ?? { latencies: [], codes: {} };
  entry.latencies.push(performance.now() - started);
  entry.codes[status] = (entry.codes[status] ?? 0) + 1;
  stats.set(route, entry);
  if (typeof status !== "number" || status >= 500) failures.push(`${route} → ${status}`);
  return { status, data: json?.data };
}

interface Context {
  businessId: string;
  serviceId: string;
  professionalIds: string[];
  days: string[];
}

async function virtualUser(user: number, run: string, ctx: Context) {
  const email = `cliente-${run}-${user}@loadtest.test`;
  const result = { registered: false, loggedIn: false, booked: false, conflicts: 0 };

  const register = await call(user, "POST /auth/register", "/auth/register", { body: { name: `Cliente ${user}`, email, password: PASSWORD } });
  result.registered = register.status === 201;
  if (!result.registered) return result;

  const login = await call(user, "POST /auth/login", "/auth/login", { body: { email, password: PASSWORD } });
  const token: string | undefined = login.data?.accessToken;
  result.loggedIn = Boolean(token);
  if (!token) return result;

  await call(user, "GET /auth/me", "/auth/me", { token });
  await call(user, "GET /businesses/:id", `/businesses/${ctx.businessId}`, { token });
  await call(user, "GET /services", `/services?businessId=${ctx.businessId}`, { token });
  await call(user, "GET /professionals", `/professionals?businessId=${ctx.businessId}`, { token });

  // Como na app: escolhe um horário livre; se outro cliente chegou primeiro (409), volta a
  // consultar e tenta outro. Todos preferem os primeiros horários, para haver disputa.
  for (let attempt = 0; attempt < 3 && !result.booked; attempt++) {
    const date = ctx.days[(user + attempt) % ctx.days.length];
    const professionalId = ctx.professionalIds[(user + attempt) % ctx.professionalIds.length];
    const query = `businessId=${ctx.businessId}&professionalId=${professionalId}&serviceId=${ctx.serviceId}&date=${date}`;
    const availability = await call(user, "GET /availability", `/availability?${query}`, { token });
    const slots: { time: string }[] = Array.isArray(availability.data) ? availability.data : [];
    if (!slots.length) continue;
    const slot = slots[Math.floor(Math.random() * Math.min(slots.length, 4))];
    const booking = await call(user, "POST /appointments", "/appointments", {
      token,
      body: { businessId: ctx.businessId, serviceId: ctx.serviceId, professionalId, scheduledAt: slot.time },
    });
    if (booking.status === 201) result.booked = true;
    else if (booking.status === 409) result.conflicts++;
  }

  await call(user, "GET /appointments", "/appointments", { token });
  return result;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

function nextDays(count: number): string[] {
  return Array.from({ length: count }, (_, i) => new Date(Date.now() + (i + 1) * 86_400_000).toISOString().slice(0, 10));
}

// ---------------------------------------------------------------- execução

async function main() {
  await assertPortFree();
  console.log(`Base de dados: ${new URL(DATABASE_URL).host}${new URL(DATABASE_URL).pathname} (local, esvaziada)`);
  const prisma = await prepareDatabase();

  let failed = false;
  try {
    await startApi();
    console.log(`API do teste: pid ${api!.pid}, porta ${PORT}`);
    const business = await prisma.business.findFirstOrThrow();
    const ctx: Context = {
      businessId: business.id,
      serviceId: (await prisma.service.findFirstOrThrow()).id,
      professionalIds: (await prisma.professional.findMany()).map((p: { id: string }) => p.id),
      days: nextDays(DAYS),
    };

    for (const users of LEVELS) {
      // Cada nível começa com a agenda vazia e contadores novos.
      await prisma.payment.deleteMany();
      await prisma.appointment.deleteMany();
      stats = new Map();
      failures = [];
      serverErrors.length = 0;

      console.log(`\n▶ ${users} clientes em simultâneo | ${PROFESSIONALS} profissional(is) | ${DAYS} dia(s)`);
      const run = `${Date.now().toString(36)}${users}`;
      const started = performance.now();
      const results = await Promise.all(Array.from({ length: users }, (_, i) => virtualUser(i, run, ctx)));
      const seconds = (performance.now() - started) / 1000;

      const requests = [...stats.values()].reduce((n, s) => n + s.latencies.length, 0);
      console.log(`Tempo total ${seconds.toFixed(1)} s | ${requests} pedidos | ${(requests / seconds).toFixed(0)} pedidos/s`);
      console.log(`${"Rota".padEnd(22)}${"n".padStart(6)}${"p50 ms".padStart(9)}${"p95 ms".padStart(9)}${"máx ms".padStart(9)}  códigos`);
      for (const [route, s] of stats) {
        console.log(
          route.padEnd(22) +
            String(s.latencies.length).padStart(6) +
            percentile(s.latencies, 50).toFixed(0).padStart(9) +
            percentile(s.latencies, 95).toFixed(0).padStart(9) +
            Math.max(...s.latencies).toFixed(0).padStart(9) +
            "  " +
            JSON.stringify(s.codes),
        );
      }

      const count = (key: "registered" | "loggedIn" | "booked") => results.filter((r) => r[key]).length;
      const conflicts = results.reduce((n, r) => n + r.conflicts, 0);
      const [{ overlaps }] = await prisma.$queryRaw<{ overlaps: bigint }[]>`
        SELECT count(*) AS overlaps FROM appointments a JOIN appointments b
          ON a."professionalId" = b."professionalId" AND a.id < b.id
         AND a.status NOT IN ('CANCELLED') AND b.status NOT IN ('CANCELLED')
         AND a."scheduledAt" < b."scheduledAt" + b."durationMinutes" * interval '1 minute'
         AND b."scheduledAt" < a."scheduledAt" + a."durationMinutes" * interval '1 minute'`;

      console.log(`Cadastro ${count("registered")}/${users} | login ${count("loggedIn")}/${users} | marcaram ${count("booked")}/${users} | 409 horário ocupado: ${conflicts}`);
      console.log(`Marcações sobrepostas na base: ${overlaps} | erros 5xx/timeout/rede: ${failures.length}`);
      const grouped = new Map<string, number>();
      for (const f of [...failures, ...serverErrors.map((e) => `servidor: ${e}`)]) grouped.set(f, (grouped.get(f) ?? 0) + 1);
      for (const [message, n] of grouped) console.log(`  ${n}× ${message}`);
      if (failures.length || Number(overlaps) > 0) failed = true;
    }
  } finally {
    await stopApi();
    await prisma.$disconnect();
  }
  console.log(failed ? "\nRESULTADO: FALHOU" : "\nRESULTADO: OK");
  process.exit(failed ? 1 : 0);
}

main().catch((error) => void abort(1, error));
