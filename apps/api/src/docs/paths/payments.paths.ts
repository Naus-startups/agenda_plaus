import { createPaymentSchema } from "@slotix/validation";
import { z } from "zod";
import { authErrors, bearerAuth, commonErrors, forbiddenError, listSuccessResponse, registry, successResponse } from "../registry";
import { paymentSchema } from "../schemas";

const idParam = z.object({ id: z.guid() });
const proofFile = z.string().openapi({ type: "string", format: "binary", description: "Comprovativo: JPEG, PNG, WEBP ou PDF, até 4 MB." });

registry.registerPath({
  method: "post",
  path: "/payments",
  tags: ["Payments"],
  summary: "Registar pagamento de um agendamento",
  security: bearerAuth,
  request: { body: { content: { "application/json": { schema: createPaymentSchema } } } },
  responses: { 201: successResponse(paymentSchema), ...commonErrors, ...authErrors, ...forbiddenError },
});

registry.registerPath({
  method: "post",
  path: "/payments/receive",
  tags: ["Payments"],
  summary: "Registar pagamento recebido presencialmente (staff, em nome do negócio)",
  description:
    "Diferente de POST /payments (o cliente paga a própria marcação): aqui o staff regista um pagamento já recebido (dinheiro, cartão...). Fica PAID e o agendamento CONFIRMED conclui-se imediatamente, atomicamente. Exige que o agendamento esteja CONFIRMED, no mesmo dia, a partir da hora marcada (nunca antes). Transferência (BANK_TRANSFER) e Multicaixa Express (MULTICAIXA) exigem o comprovativo: envie em multipart/form-data com o ficheiro no campo `proof` (JPEG, PNG, WEBP ou PDF, até 4 MB).",
  security: bearerAuth,
  request: {
    body: {
      content: {
        "application/json": { schema: createPaymentSchema },
        "multipart/form-data": { schema: createPaymentSchema.extend({ proof: proofFile.optional() }) },
      },
    },
  },
  responses: { 201: successResponse(paymentSchema), ...commonErrors, ...authErrors, ...forbiddenError },
});

registry.registerPath({
  method: "get",
  path: "/payments",
  tags: ["Payments"],
  summary: "Listar pagamentos",
  security: bearerAuth,
  responses: { 200: listSuccessResponse(paymentSchema), ...authErrors },
});

registry.registerPath({
  method: "get",
  path: "/payments/{id}",
  tags: ["Payments"],
  summary: "Detalhe de um pagamento",
  security: bearerAuth,
  request: { params: idParam },
  responses: { 200: successResponse(paymentSchema), ...commonErrors, ...authErrors },
});

registry.registerPath({
  method: "get",
  path: "/payments/{id}/proof",
  tags: ["Payments"],
  summary: "Ficheiro do comprovativo de um pagamento",
  description: "Devolve a imagem ou o PDF (Content-Disposition inline). Só para quem pode ver o pagamento.",
  security: bearerAuth,
  request: { params: idParam },
  responses: {
    200: {
      description: "O ficheiro do comprovativo.",
      content: { "image/*": { schema: proofFile }, "application/pdf": { schema: proofFile } },
    },
    ...commonErrors,
    ...authErrors,
  },
});

registry.registerPath({
  method: "post",
  path: "/payments/{id}/proof",
  tags: ["Payments"],
  summary: "Anexar o comprovativo a um pagamento pago que ainda não o tem (staff)",
  description: "Um comprovativo já anexado nunca é substituído (409 PAYMENT_PROOF_EXISTS).",
  security: bearerAuth,
  request: { params: idParam, body: { content: { "multipart/form-data": { schema: z.object({ proof: proofFile }) } } } },
  responses: { 201: successResponse(paymentSchema), ...commonErrors, ...authErrors, ...forbiddenError },
});

registry.registerPath({
  method: "patch",
  path: "/payments/{id}/pay",
  tags: ["Payments"],
  summary: "Marcar pagamento como pago (dono)",
  security: bearerAuth,
  request: { params: idParam },
  responses: { 200: successResponse(paymentSchema), ...commonErrors, ...authErrors, ...forbiddenError },
});

registry.registerPath({
  method: "patch",
  path: "/payments/{id}/fail",
  tags: ["Payments"],
  summary: "Marcar pagamento como falhado (dono)",
  security: bearerAuth,
  request: { params: idParam },
  responses: { 200: successResponse(paymentSchema), ...commonErrors, ...authErrors, ...forbiddenError },
});

registry.registerPath({
  method: "patch",
  path: "/payments/{id}/refund",
  tags: ["Payments"],
  summary: "Reembolsar pagamento (dono)",
  security: bearerAuth,
  request: { params: idParam },
  responses: { 200: successResponse(paymentSchema), ...commonErrors, ...authErrors, ...forbiddenError },
});
