export type Role = "CUSTOMER" | "OWNER" | "EMPLOYEE" | "ADMIN";

export type AppointmentStatus =
  | "PENDING"
  | "CONFIRMED"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW";

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
}

export interface ApiListSuccess<T> {
  success: true;
  data: T[];
  meta: PaginationMeta;
}

export type ApiListResponse<T> = ApiListSuccess<T> | ApiError;

export interface UserDTO {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  avatarUrl: string | null;
  role: Role;
  // The last position the app saved for this user; null until they allow location.
  latitude: number | null;
  longitude: number | null;
  locationUpdatedAt: string | null;
  // YYYY-MM-DD, given by the client for birthday rewards.
  birthDate?: string | null;
  // Whether the spaces they are members of may send promotions and campaigns.
  notifyPromotions?: boolean;
  createdAt: string;
}

export interface AuthTokensDTO {
  accessToken: string;
  refreshToken: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
  phone?: string;
}

export interface LoginResponse extends AuthTokensDTO {
  user: UserDTO;
}

export interface BusinessDTO {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  address: string | null;
  phone: string | null;
  category: string | null;
  // The gallery cover.
  imageUrl: string | null;
  // The logo set in the dashboard; apps show it ahead of imageUrl.
  logoUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  // The region the pin falls in, as OpenStreetMap names it. All null until the owner
  // marks the location.
  provincia: string | null;
  municipio: string | null;
  distrito: string | null;
  bairro: string | null;
  rua: string | null;
  ratingAvg: number | null;
  ratingCount: number;
  // How many users have this business in their favorites.
  favoriteCount: number;
  // Only present when the request included the viewer's latitude/longitude.
  distanceKm: number | null;
  createdAt: string;
  updatedAt: string;
}

export type BusinessSortBy = "recommended" | "nearest" | "topRated" | "mostFavorited";

export interface BusinessListQuery {
  category?: string;
  provincia?: string;
  municipio?: string;
  bairro?: string;
  search?: string;
  minRating?: number;
  minPrice?: number;
  maxPrice?: number;
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  sortBy?: BusinessSortBy;
  // Only the businesses favorited by a good share of the app's customers.
  popular?: boolean;
  page?: number;
  limit?: number;
}

// A place where businesses exist, with how many. municipio/bairro are null for the
// businesses whose pin has no such level in OpenStreetMap.
export interface LocalityDTO {
  provincia: string;
  municipio: string | null;
  bairro: string | null;
  count: number;
}

// A province of Angola as OpenStreetMap has it, with the centre of its territory.
export interface ProvinceDTO {
  name: string;
  latitude: number;
  longitude: number;
}

// A named place inside a province (town, bairro, neighbourhood) and where it is.
export interface ZoneDTO {
  name: string;
  latitude: number;
  longitude: number;
}

// What OpenStreetMap knows about a point or a searched address.
export interface PlaceDTO {
  // The full address as OpenStreetMap writes it.
  displayName: string;
  // Street and number (or the place's own name), without the region.
  street: string;
  bairro: string | null;
  // The urban district ("Distrito Urbano da Maianga"), where the map has one.
  distrito: string | null;
  municipio: string | null;
  provincia: string | null;
  latitude: number;
  longitude: number;
}

export interface BusinessHoursEntryDTO {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

// O estado de um profissional agora (sem nada sobre os clientes que atende).
export type ProfessionalStatus = "AVAILABLE" | "BUSY" | "AWAY" | "OFF_HOURS";

export interface ProfessionalStatusDTO {
  professionalId: string;
  status: ProfessionalStatus;
  // BUSY: quando acaba a marcação em curso. AWAY: até quando (null = o resto do dia).
  until: string | null;
  // Quando fica livre para uma marcação hoje (null = hoje já não).
  freeAt: string | null;
  minutesUntilFree: number | null;
  // AVAILABLE: a próxima marcação de hoje (null = livre até fechar).
  nextBusyAt: string | null;
  // OFF_HOURS: quando o espaço abre hoje (null = hoje já não abre).
  opensAt: string | null;
  reason: string | null;
}

export interface ProfessionalBlockDTO {
  id: string;
  professionalId: string;
  startAt: string;
  endAt: string;
  reason: string | null;
}

export interface AvailabilityQuery {
  businessId: string;
  professionalId: string;
  serviceId: string;
  date: string;
}

export interface AvailabilitySlotDTO {
  time: string;
}

export interface ServiceDTO {
  id: string;
  businessId: string;
  name: string;
  description: string | null;
  price: number;
  duration: number;
  category: string | null;
  imageUrl: string | null;
  active: boolean;
  // Only members of the space's loyalty programme can book it.
  membersOnly?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProfessionalDTO {
  id: string;
  businessId: string;
  userId: string;
  name: string;
  bio: string | null;
  specialty: string | null;
  imageUrl: string | null;
  ratingAvg: number | null;
  ratingCount: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ClientDTO {
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  // The photo from the client's own app account.
  avatarUrl: string | null;
  // When they became a client of the business (accepted when booking in the app).
  clientSince: string | null;
  visits: number;
  totalSpent: number;
  lastVisit: string | null;
  status: "active" | "vip" | "inactive";
}

// Whether the signed-in app user is a client of a business. Booking there does not make
// them one: the app asks, and they can decline and still book.
export interface BusinessMembershipDTO {
  businessId: string;
  isClient: boolean;
  clientSince: string | null;
}

// A customer the business knows offline (walk-in, phone booking) with no account of
// their own. Distinct from ClientDTO, which is derived from a User's booking history.
export interface WalkInClientDTO {
  id: string;
  businessId: string;
  name: string;
  phone: string;
  email: string | null;
  active: boolean;
  visits: number;
  totalSpent: number;
  lastVisit: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWalkInClientRequest {
  name: string;
  phone: string;
  email?: string;
}

export interface UpdateWalkInClientRequest {
  name?: string;
  phone?: string;
  email?: string;
  active?: boolean;
}

export interface AppointmentDTO {
  id: string;
  businessId: string;
  // Exactly one of the two is non-null: clientId for a self-service booking, walkInClientId
  // for one entered by the business on behalf of someone without an account.
  clientId: string | null;
  walkInClientId: string | null;
  serviceId: string;
  professionalId: string;
  scheduledAt: string;
  // What the client pays, after the discounts below; originalPrice is the service's price.
  price: number;
  originalPrice: number;
  discountTotal: number;
  status: AppointmentStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAppointmentRequest {
  businessId: string;
  serviceId: string;
  professionalId: string;
  scheduledAt: string;
  notes?: string;
  // A reward to use (one unlocked, or one bought with points) and the total the app showed.
  memberRewardId?: string;
  pointsRewardId?: string;
  expectedPrice?: number;
}

// Booked by the business on behalf of a walk-in client, not by the client themselves.
export interface CreateWalkInAppointmentRequest {
  businessId: string;
  walkInClientId: string;
  serviceId: string;
  professionalId: string;
  scheduledAt: string;
  notes?: string;
}

export interface FavoriteDTO {
  id: string;
  businessId: string;
  business: BusinessDTO;
  createdAt: string;
}

export interface ReviewDTO {
  id: string;
  businessId: string;
  clientId: string;
  clientName: string;
  appointmentId: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReviewRequest {
  appointmentId: string;
  rating: number;
  comment?: string;
}

export interface NotificationDTO {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export type PaymentStatus = "PENDING" | "PAID" | "FAILED" | "REFUNDED";

export type PaymentMethod = "CASH" | "CARD" | "MULTICAIXA" | "BANK_TRANSFER" | "OTHER";

export interface PaymentDTO {
  id: string;
  appointmentId: string;
  // Mirrors AppointmentDTO: exactly one of the two is non-null, matching whichever one
  // the paid appointment itself used.
  userId: string | null;
  walkInClientId: string | null;
  businessId: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  status: PaymentStatus;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePaymentRequest {
  appointmentId: string;
  method: PaymentMethod;
}

// Staff recording a payment received in person (cash/card/etc) on behalf of the
// business, as opposed to CreatePaymentRequest, which is the customer paying through the
// app for their own appointment.
export interface ReceivePaymentRequest {
  appointmentId: string;
  method: PaymentMethod;
}

export interface GalleryImageDTO {
  id: string;
  businessId: string;
  url: string;
  position: number;
  caption: string | null;
  createdAt: string;
  // The transfer / Multicaixa Express proof attached when the payment was received; the
  // file itself is read through GET /payments/:id/proof.
  proof: PaymentProofDTO | null;
}

export type SearchSortBy = "recommended" | "nearest" | "bestPrice" | "topRated";

export interface PaymentProofDTO {
  fileName: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
}

export interface MatchedServiceDTO {
  id: string;
  name: string;
  price: number;
}

export interface SearchResultDTO {
  business: BusinessDTO;
  matchedService: MatchedServiceDTO | null;
}

export interface SearchQuery {
  q: string;
  latitude?: number;
  longitude?: number;
  sortBy?: SearchSortBy;
  page?: number;
  limit?: number;
}

export interface FinancialsPaymentDTO {
  id: string;
  amount: number;
  method: PaymentMethod;
  paidAt: string;
  appointmentId: string;
  scheduledAt: string;
  clientName: string;
  clientAvatarUrl: string | null;
  serviceName: string;
  professionalName: string;
}

export interface FinancialsSummaryDTO {
  period: { month: string; start: string; end: string };
  summary: { todayRevenue: number; monthlyRevenue: number; paymentsReceived: number; todayPayments: number };
  paymentMethods: Record<PaymentMethod, number>;
  payments: FinancialsPaymentDTO[];
}

export interface UpdateProfileRequest {
  name?: string;
  phone?: string;
  avatarUrl?: string;
  birthDate?: string | null;
  notifyPromotions?: boolean;
}

export * from "./locations";
export * from "./categories";

/* =========================================================================
   Fidelização, benefícios e promoções
   ========================================================================= */

export type DiscountType = "PERCENT" | "AMOUNT" | "FREE";
export type PromotionAudience = "ALL" | "MEMBERS";
export type PromotionStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "ENDED";
export type LoyaltyMemberStatus = "ACTIVE" | "SUSPENDED" | "REMOVED" | "LEFT";
export type LoyaltyRewardKind = "POINTS" | "VISITS" | "BIRTHDAY";
export type MemberRewardStatus = "AVAILABLE" | "RESERVED" | "USED" | "EXPIRED" | "CANCELLED";
export type LoyaltyTransactionType = "EARN" | "REDEEM" | "REFUND" | "REVERSAL" | "EXPIRE" | "ADJUST";

export interface LoyaltyProgramDTO {
  businessId: string;
  active: boolean;
  name: string;
  description: string | null;
  joinRules: string | null;
  terms: string | null;
  pointsEnabled: boolean;
  pointsPerUnit: number;
  amountPerUnit: number;
  pointsExpireDays: number | null;
}

export interface LoyaltyBenefitDTO {
  id: string;
  title: string;
  description: string | null;
  conditions: string | null;
  validFrom: string | null;
  validUntil: string | null;
  active: boolean;
}

export interface LoyaltyRewardDTO {
  id: string;
  name: string;
  description: string | null;
  kind: LoyaltyRewardKind;
  pointsCost: number | null;
  visitsRequired: number | null;
  discountType: DiscountType;
  discountValue: number;
  validDays: number | null;
  active: boolean;
  serviceIds: string[];
}

export interface PromotionDTO {
  id: string;
  name: string;
  description: string | null;
  audience: PromotionAudience;
  status: PromotionStatus;
  discountType: DiscountType;
  discountValue: number;
  startsAt: string | null;
  endsAt: string | null;
  membersFrom: string | null;
  weekdays: number[];
  startMinute: number | null;
  endMinute: number | null;
  maxUses: number | null;
  maxUsesPerClient: number | null;
  stackable: boolean;
  // Campaign rule: a cancelled or missed booking gives its use back.
  releaseOnCancel: boolean;
  serviceIds: string[];
  // Reserved + consumed uses; remaining is null when there is no limit.
  usedCount: number;
  remaining: number | null;
}

export interface PromotionResultsDTO {
  promotion: PromotionDTO;
  reserved: number;
  consumed: number;
  released: number;
  discountGiven: number;
  usages: {
    id: string;
    appointmentId: string;
    clientName: string;
    status: "RESERVED" | "CONSUMED" | "RELEASED";
    discountAmount: number;
    scheduledAt: string;
    createdAt: string;
  }[];
}

export interface MemberRewardDTO {
  id: string;
  rewardId: string;
  name: string;
  description: string | null;
  kind: LoyaltyRewardKind;
  discountType: DiscountType;
  discountValue: number;
  serviceIds: string[];
  status: MemberRewardStatus;
  expiresAt: string | null;
  createdAt: string;
}

export interface LoyaltyTransactionDTO {
  id: string;
  type: LoyaltyTransactionType;
  points: number;
  balanceAfter: number;
  reason: string | null;
  appointmentId: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface NextRewardDTO {
  rewardId: string;
  name: string;
  kind: LoyaltyRewardKind;
  // How far the member still is: points still missing, or paid services still missing.
  pointsNeeded: number | null;
  visitsNeeded: number | null;
}

export interface MyMembershipDTO {
  id: string;
  businessId: string;
  businessName: string;
  businessLogoUrl: string | null;
  programName: string;
  status: LoyaltyMemberStatus;
  plan: string;
  joinedAt: string;
  pointsBalance: number;
  pointsEnabled: boolean;
  visits: number;
  level: string | null;
  nextReward: NextRewardDTO | null;
  availableRewards: MemberRewardDTO[];
}

export interface MemberAreaDTO extends MyMembershipDTO {
  benefits: LoyaltyBenefitDTO[];
  rewards: LoyaltyRewardDTO[];
  promotions: PromotionDTO[];
  transactions: LoyaltyTransactionDTO[];
  rewardHistory: MemberRewardDTO[];
}

// What the app shows on a space's page: the programme (if it is on) and the membership.
export interface BusinessLoyaltyDTO {
  program: LoyaltyProgramDTO | null;
  benefits: LoyaltyBenefitDTO[];
  rewards: LoyaltyRewardDTO[];
  promotions: PromotionDTO[];
  membersOnlyServiceIds: string[];
  membership: MyMembershipDTO | null;
}

export interface LoyaltyMemberDTO {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  status: LoyaltyMemberStatus;
  plan: string;
  pointsBalance: number;
  joinedAt: string;
  visits: number;
  lastVisit: string | null;
}

export interface LoyaltyMemberDetailDTO extends LoyaltyMemberDTO {
  transactions: LoyaltyTransactionDTO[];
  rewards: MemberRewardDTO[];
  history: { id: string; action: string; reason: string | null; createdAt: string }[];
}

export interface LoyaltyOverviewDTO {
  totalMembers: number;
  activeMembers: number;
  newMembers30d: number;
  pointsIssued: number;
  pointsRedeemed: number;
  rewardsUsed: number;
  activePromotions: number;
  topMembers: { memberId: string; name: string; visits: number; pointsBalance: number }[];
  campaigns: { id: string; name: string; status: PromotionStatus; usedCount: number; maxUses: number | null; discountGiven: number }[];
}

export interface AppliedDiscountDTO {
  source: "PROMOTION" | "REWARD";
  label: string;
  amount: number;
  promotionId: string | null;
}

export interface RewardOptionDTO {
  // memberRewardId for an unlocked reward, pointsRewardId for one bought with points.
  memberRewardId: string | null;
  pointsRewardId: string | null;
  name: string;
  pointsCost: number | null;
  discountType: DiscountType;
  discountValue: number;
  expiresAt: string | null;
}

export interface PriceQuoteDTO {
  originalPrice: number;
  discounts: AppliedDiscountDTO[];
  discountTotal: number;
  finalPrice: number;
  isMember: boolean;
  // Offered to members only: booking it as someone else is refused.
  membersOnlyService: boolean;
  // Rewards the client could use on this appointment (pass one back when booking).
  rewardOptions: RewardOptionDTO[];
  pointsBalance: number | null;
}
