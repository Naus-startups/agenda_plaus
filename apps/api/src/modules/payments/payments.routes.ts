import { Router } from "express";
import { createPaymentSchema } from "@slotix/validation";
import { authenticate } from "../../shared/middleware/authenticate";
import { authorize } from "../../shared/middleware/authorize";
import { proofUpload } from "../../shared/middleware/upload";
import { validate } from "../../shared/middleware/validate";
import { paymentsController } from "./payments.controller";

export const paymentsRoutes = Router();

paymentsRoutes.use(authenticate);

paymentsRoutes.post("/", authorize("CUSTOMER", "ADMIN"), validate(createPaymentSchema), paymentsController.create);
// Staff recording a payment received in person — same body shape, different semantics
// (see paymentsService.receivePayment): PAID immediately, appointment auto-completes.
// JSON or multipart; as multipart it may carry the payment proof in the "proof" field.
paymentsRoutes.post(
  "/receive",
  authorize("OWNER", "EMPLOYEE", "ADMIN"),
  proofUpload.single("proof"),
  validate(createPaymentSchema),
  paymentsController.receivePayment,
);
paymentsRoutes.get("/", paymentsController.list);
paymentsRoutes.get("/:id", paymentsController.getById);
paymentsRoutes.get("/:id/proof", paymentsController.getProof);
paymentsRoutes.post("/:id/proof", authorize("OWNER", "EMPLOYEE", "ADMIN"), proofUpload.single("proof"), paymentsController.attachProof);
paymentsRoutes.patch("/:id/pay", authorize("OWNER", "ADMIN"), paymentsController.markAsPaid);
paymentsRoutes.patch("/:id/fail", authorize("OWNER", "ADMIN"), paymentsController.markAsFailed);
paymentsRoutes.patch("/:id/refund", authorize("OWNER", "ADMIN"), paymentsController.refund);
