import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { resetRateLimits } from "../../src/shared/middleware/rateLimit";
import { app, auth, createAppointment, createBusinessFixture, createPayment, prisma, resetDatabase, type BusinessFixture } from "./helpers";

let a: BusinessFixture;

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
  a = await createBusinessFixture("A");
});

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n", "latin1");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

// Uma marcação confirmada que já chegou à hora: pode receber o pagamento agora.
const payable = () => createAppointment(a, { status: "CONFIRMED", scheduledAt: new Date(Date.now() - 60_000) });

function receive(token: string, appointmentId: string, method: string, proof?: { buffer: Buffer; name: string; type: string }) {
  const req = request(app).post("/api/v1/payments/receive").set(auth(token)).field("appointmentId", appointmentId).field("method", method);
  return proof ? req.attach("proof", proof.buffer, { filename: proof.name, contentType: proof.type }) : req;
}

describe("Comprovativo de transferência / Multicaixa Express", () => {
  it("sem comprovativo, a transferência é recusada e nada é registado", async () => {
    const appointment = await payable();

    const response = await receive(a.owner.token, appointment.id, "BANK_TRANSFER");
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("PAYMENT_PROOF_REQUIRED");
    expect(await prisma.payment.count()).toBe(0);
    expect((await prisma.appointment.findUnique({ where: { id: appointment.id } }))!.status).toBe("CONFIRMED");
  });

  it("com o PDF, o funcionário regista o Express e o ficheiro volta igual a quem pode ver o pagamento", async () => {
    const appointment = await payable();

    const created = await receive(a.employee.token, appointment.id, "MULTICAIXA", { buffer: PDF, name: "transferência 12-11.pdf", type: "application/pdf" });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe("PAID");
    expect(created.body.data.proof).toMatchObject({ fileName: "transferência 12-11.pdf", mimeType: "application/pdf", size: PDF.length });

    const listed = await request(app).get(`/api/v1/payments?businessId=${a.business.id}`).set(auth(a.owner.token));
    expect(listed.body.data[0].proof.fileName).toBe("transferência 12-11.pdf");

    for (const token of [a.owner.token, a.employee.token, a.customer.token]) {
      const file = await request(app).get(`/api/v1/payments/${created.body.data.id}/proof`).set(auth(token)).buffer(true).parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      });
      expect(file.status).toBe(200);
      expect(file.headers["content-type"]).toBe("application/pdf");
      expect(file.headers["cache-control"]).toBe("private, no-store");
      expect(Buffer.compare(file.body as Buffer, PDF)).toBe(0);
    }
  });

  it("outro espaço não vê o comprovativo", async () => {
    const appointment = await payable();
    const created = await receive(a.owner.token, appointment.id, "BANK_TRANSFER", { buffer: PNG, name: "talão.png", type: "image/png" });
    const b = await createBusinessFixture("B");

    const response = await request(app).get(`/api/v1/payments/${created.body.data.id}/proof`).set(auth(b.owner.token));
    expect(response.status).toBe(403);
  });

  it("um ficheiro que não é o que diz ser é recusado antes de registar o pagamento", async () => {
    const appointment = await payable();
    const fake = Buffer.from("<html><script>alert(1)</script></html>");

    const response = await receive(a.owner.token, appointment.id, "BANK_TRANSFER", { buffer: fake, name: "comprovativo.pdf", type: "application/pdf" });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("PAYMENT_PROOF_CONTENT_INVALID");
    expect(await prisma.payment.count()).toBe(0);
    expect(await prisma.paymentProof.count()).toBe(0);
  });

  it("dinheiro continua sem comprovativo, também em JSON", async () => {
    const appointment = await payable();

    const response = await request(app).post("/api/v1/payments/receive").set(auth(a.owner.token)).send({ appointmentId: appointment.id, method: "CASH" });
    expect(response.status).toBe(201);
    expect(response.body.data.proof).toBeNull();
  });

  it("um pagamento sem comprovativo pode recebê-lo depois, mas nunca é substituído", async () => {
    const appointment = await createAppointment(a, { status: "COMPLETED" });
    const payment = await createPayment(a, appointment.id, "PAID");
    const attach = () =>
      request(app).post(`/api/v1/payments/${payment.id}/proof`).set(auth(a.employee.token)).attach("proof", PNG, { filename: "talão.png", contentType: "image/png" });

    const first = await attach();
    expect(first.status).toBe(201);
    expect(first.body.data.proof.mimeType).toBe("image/png");

    const second = await attach();
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("PAYMENT_PROOF_EXISTS");
    expect(await prisma.paymentProof.count()).toBe(1);
  });

  it("o cliente não anexa comprovativos", async () => {
    const appointment = await createAppointment(a, { status: "COMPLETED" });
    const payment = await createPayment(a, appointment.id, "PAID");

    const response = await request(app).post(`/api/v1/payments/${payment.id}/proof`).set(auth(a.customer.token)).attach("proof", PNG, { filename: "x.png", contentType: "image/png" });
    expect(response.status).toBe(403);
  });
});
