import type { Request, Response } from "express";
import { sendSuccess } from "../../shared/utils/apiResponse";
import { loyaltyService } from "./loyalty.service";
import { quote } from "./loyalty.booking";
import type {
  BenefitInput,
  MemberStatusInput,
  PointsAdjustmentInput,
  ProgramInput,
  PromotionInput,
  QuoteInput,
  RewardInput,
} from "./loyalty.schema";

type BusinessParams = { businessId: string };
type WithId = BusinessParams & { id: string };

// Every admin action reads the business from the URL and the person from the session; the
// service checks that this person may act on that business (and that the row is its own).
export const loyaltyController = {
  // Cliente
  async publicInfo(req: Request<BusinessParams>, res: Response) {
    sendSuccess(res, await loyaltyService.getBusinessLoyalty(req.params.businessId, req.user?.role === "CUSTOMER" ? req.user.id : undefined));
  },
  async join(req: Request<BusinessParams>, res: Response) {
    sendSuccess(res, await loyaltyService.join(req.params.businessId, req.user!.id), 201);
  },
  async leave(req: Request<BusinessParams>, res: Response) {
    sendSuccess(res, await loyaltyService.leave(req.params.businessId, req.user!.id));
  },
  async memberArea(req: Request<BusinessParams>, res: Response) {
    sendSuccess(res, await loyaltyService.memberArea(req.params.businessId, req.user!.id));
  },
  async myMemberships(req: Request, res: Response) {
    sendSuccess(res, await loyaltyService.myMemberships(req.user!.id));
  },
  async quote(req: Request, res: Response) {
    sendSuccess(res, await quote(req.user!.id, req.body as QuoteInput));
  },

  // Painel
  async getProgram(req: Request<BusinessParams>, res: Response) {
    sendSuccess(res, await loyaltyService.getProgram(req.params.businessId, req.user!.id));
  },
  async saveProgram(req: Request<BusinessParams>, res: Response) {
    sendSuccess(res, await loyaltyService.saveProgram(req.params.businessId, req.user!.id, req.body as ProgramInput));
  },
  async overview(req: Request<BusinessParams>, res: Response) {
    sendSuccess(res, await loyaltyService.overview(req.params.businessId, req.user!.id));
  },
  async listMembers(req: Request<BusinessParams>, res: Response) {
    const search = typeof req.query.q === "string" ? req.query.q.slice(0, 100) : undefined;
    sendSuccess(res, await loyaltyService.listMembers(req.params.businessId, req.user!.id, search));
  },
  async getMember(req: Request<WithId>, res: Response) {
    sendSuccess(res, await loyaltyService.getMember(req.params.businessId, req.user!.id, req.params.id));
  },
  async setMemberStatus(req: Request<WithId>, res: Response) {
    sendSuccess(res, await loyaltyService.setMemberStatus(req.params.businessId, req.user!.id, req.params.id, req.body as MemberStatusInput));
  },
  async adjustPoints(req: Request<WithId>, res: Response) {
    sendSuccess(res, await loyaltyService.adjustPoints(req.params.businessId, req.user!.id, req.params.id, req.body as PointsAdjustmentInput), 201);
  },
  async listBenefits(req: Request<BusinessParams>, res: Response) {
    sendSuccess(res, await loyaltyService.listBenefits(req.params.businessId, req.user!.id));
  },
  async createBenefit(req: Request<BusinessParams>, res: Response) {
    sendSuccess(res, await loyaltyService.createBenefit(req.params.businessId, req.user!.id, req.body as BenefitInput), 201);
  },
  async updateBenefit(req: Request<WithId>, res: Response) {
    sendSuccess(res, await loyaltyService.updateBenefit(req.params.businessId, req.user!.id, req.params.id, req.body as BenefitInput));
  },
  async deleteBenefit(req: Request<WithId>, res: Response) {
    sendSuccess(res, await loyaltyService.deleteBenefit(req.params.businessId, req.user!.id, req.params.id));
  },
  async listRewards(req: Request<BusinessParams>, res: Response) {
    sendSuccess(res, await loyaltyService.listRewards(req.params.businessId, req.user!.id));
  },
  async createReward(req: Request<BusinessParams>, res: Response) {
    sendSuccess(res, await loyaltyService.createReward(req.params.businessId, req.user!.id, req.body as RewardInput), 201);
  },
  async updateReward(req: Request<WithId>, res: Response) {
    sendSuccess(res, await loyaltyService.updateReward(req.params.businessId, req.user!.id, req.params.id, req.body as RewardInput));
  },
  async deleteReward(req: Request<WithId>, res: Response) {
    sendSuccess(res, await loyaltyService.deleteReward(req.params.businessId, req.user!.id, req.params.id));
  },
  async listPromotions(req: Request<BusinessParams>, res: Response) {
    sendSuccess(res, await loyaltyService.listPromotions(req.params.businessId, req.user!.id));
  },
  async createPromotion(req: Request<BusinessParams>, res: Response) {
    sendSuccess(res, await loyaltyService.createPromotion(req.params.businessId, req.user!.id, req.body as PromotionInput), 201);
  },
  async updatePromotion(req: Request<WithId>, res: Response) {
    sendSuccess(res, await loyaltyService.updatePromotion(req.params.businessId, req.user!.id, req.params.id, req.body as PromotionInput));
  },
  async setPromotionStatus(req: Request<WithId>, res: Response) {
    const { status } = req.body as { status: "ACTIVE" | "PAUSED" | "ENDED" };
    sendSuccess(res, await loyaltyService.setPromotionStatus(req.params.businessId, req.user!.id, req.params.id, status));
  },
  async deletePromotion(req: Request<WithId>, res: Response) {
    sendSuccess(res, await loyaltyService.deletePromotion(req.params.businessId, req.user!.id, req.params.id));
  },
  async promotionResults(req: Request<WithId>, res: Response) {
    sendSuccess(res, await loyaltyService.promotionResults(req.params.businessId, req.user!.id, req.params.id));
  },
  async getMembersOnlyServices(req: Request<BusinessParams>, res: Response) {
    sendSuccess(res, await loyaltyService.getMembersOnlyServices(req.params.businessId, req.user!.id));
  },
  async setMembersOnlyServices(req: Request<BusinessParams>, res: Response) {
    const { serviceIds } = req.body as { serviceIds: string[] };
    sendSuccess(res, await loyaltyService.setMembersOnlyServices(req.params.businessId, req.user!.id, serviceIds));
  },
};
