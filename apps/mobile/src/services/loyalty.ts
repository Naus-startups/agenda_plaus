import type { BusinessLoyaltyDTO, MemberAreaDTO, MyMembershipDTO, PriceQuoteDTO } from "@slotix/types";
import { apiFetch } from "./api-client";

// O programa de membros de um espaço, como a página do espaço o mostra (e a adesão da pessoa).
export async function getBusinessLoyalty(businessId: string): Promise<BusinessLoyaltyDTO> {
  return apiFetch<BusinessLoyaltyDTO>(`/businesses/${businessId}/loyalty`);
}

export async function joinLoyalty(businessId: string): Promise<MyMembershipDTO> {
  return apiFetch<MyMembershipDTO>(`/businesses/${businessId}/loyalty/join`, { method: "POST" });
}

export async function leaveLoyalty(businessId: string): Promise<void> {
  await apiFetch<{ left: boolean }>(`/businesses/${businessId}/loyalty/membership`, { method: "DELETE" });
}

export async function getMemberArea(businessId: string): Promise<MemberAreaDTO> {
  return apiFetch<MemberAreaDTO>(`/businesses/${businessId}/loyalty/me`);
}

// "Os meus espaços": onde a pessoa é membro.
export async function listMyMemberships(): Promise<MyMembershipDTO[]> {
  return apiFetch<MyMembershipDTO[]>("/loyalty/memberships");
}

// O preço que a API calcula para a marcação (com promoções e a recompensa escolhida).
export async function quoteBooking(input: {
  businessId: string;
  serviceId: string;
  scheduledAt: string;
  memberRewardId?: string;
  pointsRewardId?: string;
}): Promise<PriceQuoteDTO> {
  return apiFetch<PriceQuoteDTO>("/loyalty/quote", { method: "POST", body: JSON.stringify(input) });
}

export function discountText(type: "PERCENT" | "AMOUNT" | "FREE", value: number): string {
  if (type === "FREE") return "Grátis";
  if (type === "PERCENT") return `${value}%`;
  return `${value.toLocaleString("pt-AO")} Kz`;
}

export function formatKz(value: number): string {
  return `${value.toLocaleString("pt-AO")} Kz`;
}
