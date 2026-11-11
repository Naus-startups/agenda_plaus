import type { Request, Response } from "express";
import type { CreatePaymentInput } from "@slotix/validation";
import { ValidationError } from "../../shared/errors";
import { sendSuccess } from "../../shared/utils/apiResponse";
import { paymentsService } from "./payments.service";
import { queryId } from "../../shared/utils/queryId";

export const paymentsController = {
  async create(req: Request, res: Response) {
    const payment = await paymentsService.create(req.user!.id, req.user!.role, req.body as CreatePaymentInput);
    sendSuccess(res, payment, 201);
  },

  async receivePayment(req: Request, res: Response) {
    const payment = await paymentsService.receivePayment(req.user!.id, req.body as CreatePaymentInput, req.file);
    sendSuccess(res, payment, 201);
  },

  async attachProof(req: Request<{ id: string }>, res: Response) {
    if (!req.file) {
      throw new ValidationError("Nenhum comprovativo enviado (campo \"proof\").", "PAYMENT_PROOF_REQUIRED");
    }
    const payment = await paymentsService.attachProof(req.params.id, req.user!.id, req.file);
    sendSuccess(res, payment, 201);
  },

  // Served inline (shown in the dashboard) and never cached: it carries bank details.
  async getProof(req: Request<{ id: string }>, res: Response) {
    const proof = await paymentsService.getProofFile(req.params.id, req.user!.id, req.user!.role);
    res.setHeader("Content-Type", proof.mimeType);
    res.setHeader("Content-Length", String(proof.buffer.length));
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(proof.fileName)}`);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(proof.buffer);
  },

  async list(req: Request, res: Response) {
    const businessId = queryId(req, "businessId");

    if (businessId) {
      const payments = await paymentsService.listByBusiness(businessId, req.user!.id);
      sendSuccess(res, payments);
      return;
    }

    const payments = await paymentsService.listMine(req.user!.id);
    sendSuccess(res, payments);
  },

  async getById(req: Request<{ id: string }>, res: Response) {
    const payment = await paymentsService.getById(req.params.id, req.user!.id, req.user!.role);
    sendSuccess(res, payment);
  },

  async markAsPaid(req: Request<{ id: string }>, res: Response) {
    const payment = await paymentsService.markAsPaid(req.params.id, req.user!.id, req.user!.role);
    sendSuccess(res, payment);
  },

  async markAsFailed(req: Request<{ id: string }>, res: Response) {
    const payment = await paymentsService.markAsFailed(req.params.id, req.user!.id, req.user!.role);
    sendSuccess(res, payment);
  },

  async refund(req: Request<{ id: string }>, res: Response) {
    const payment = await paymentsService.refund(req.params.id, req.user!.id, req.user!.role);
    sendSuccess(res, payment);
  },
};
