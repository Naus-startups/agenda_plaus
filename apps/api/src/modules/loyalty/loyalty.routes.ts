import { Router } from "express";
import { authenticate, optionalAuthenticate } from "../../shared/middleware/authenticate";
import { authorize } from "../../shared/middleware/authorize";
import { validate } from "../../shared/middleware/validate";
import { loyaltyController } from "./loyalty.controller";
import {
  benefitSchema,
  memberStatusSchema,
  pointsAdjustmentSchema,
  programSchema,
  promotionSchema,
  promotionStatusSchema,
  quoteSchema,
  rewardSchema,
  servicesMembersOnlySchema,
} from "./loyalty.schema";

/*
 * Mounted at /businesses/:businessId/loyalty (mergeParams: it needs :businessId).
 * The role checks here are only the first gate: the service checks, for each request,
 * that the person is the owner (or staff, for reading) of that very business.
 */
export const businessLoyaltyRoutes = Router({ mergeParams: true });

// Cliente (app)
businessLoyaltyRoutes.get("/", optionalAuthenticate, loyaltyController.publicInfo);
businessLoyaltyRoutes.post("/join", authenticate, authorize("CUSTOMER"), loyaltyController.join);
businessLoyaltyRoutes.delete("/membership", authenticate, authorize("CUSTOMER"), loyaltyController.leave);
businessLoyaltyRoutes.get("/me", authenticate, authorize("CUSTOMER"), loyaltyController.memberArea);

// Painel do espaço
const staff = [authenticate, authorize("OWNER", "EMPLOYEE")];
const owner = [authenticate, authorize("OWNER")];

businessLoyaltyRoutes.get("/program", ...owner, loyaltyController.getProgram);
businessLoyaltyRoutes.put("/program", ...owner, validate(programSchema), loyaltyController.saveProgram);
businessLoyaltyRoutes.get("/overview", ...owner, loyaltyController.overview);

businessLoyaltyRoutes.get("/members", ...staff, loyaltyController.listMembers);
businessLoyaltyRoutes.get("/members/:id", ...staff, loyaltyController.getMember);
businessLoyaltyRoutes.patch("/members/:id/status", ...owner, validate(memberStatusSchema), loyaltyController.setMemberStatus);
businessLoyaltyRoutes.post("/members/:id/adjustments", ...owner, validate(pointsAdjustmentSchema), loyaltyController.adjustPoints);

businessLoyaltyRoutes.get("/benefits", ...staff, loyaltyController.listBenefits);
businessLoyaltyRoutes.post("/benefits", ...owner, validate(benefitSchema), loyaltyController.createBenefit);
businessLoyaltyRoutes.put("/benefits/:id", ...owner, validate(benefitSchema), loyaltyController.updateBenefit);
businessLoyaltyRoutes.delete("/benefits/:id", ...owner, loyaltyController.deleteBenefit);

businessLoyaltyRoutes.get("/rewards", ...staff, loyaltyController.listRewards);
businessLoyaltyRoutes.post("/rewards", ...owner, validate(rewardSchema), loyaltyController.createReward);
businessLoyaltyRoutes.put("/rewards/:id", ...owner, validate(rewardSchema), loyaltyController.updateReward);
businessLoyaltyRoutes.delete("/rewards/:id", ...owner, loyaltyController.deleteReward);

businessLoyaltyRoutes.get("/promotions", ...staff, loyaltyController.listPromotions);
businessLoyaltyRoutes.post("/promotions", ...owner, validate(promotionSchema), loyaltyController.createPromotion);
businessLoyaltyRoutes.put("/promotions/:id", ...owner, validate(promotionSchema), loyaltyController.updatePromotion);
businessLoyaltyRoutes.patch("/promotions/:id/status", ...owner, validate(promotionStatusSchema), loyaltyController.setPromotionStatus);
businessLoyaltyRoutes.delete("/promotions/:id", ...owner, loyaltyController.deletePromotion);
businessLoyaltyRoutes.get("/promotions/:id/results", ...owner, loyaltyController.promotionResults);

businessLoyaltyRoutes.get("/members-only-services", ...staff, loyaltyController.getMembersOnlyServices);
businessLoyaltyRoutes.put("/members-only-services", ...owner, validate(servicesMembersOnlySchema), loyaltyController.setMembersOnlyServices);

// Mounted at /loyalty: what belongs to the signed-in client across all spaces.
export const loyaltyRoutes = Router();
loyaltyRoutes.get("/memberships", authenticate, authorize("CUSTOMER"), loyaltyController.myMemberships);
loyaltyRoutes.post("/quote", authenticate, authorize("CUSTOMER"), validate(quoteSchema), loyaltyController.quote);
