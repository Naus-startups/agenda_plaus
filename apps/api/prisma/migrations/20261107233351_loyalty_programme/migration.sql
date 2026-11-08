-- CreateEnum
CREATE TYPE "LoyaltyMemberStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REMOVED', 'LEFT');

-- CreateEnum
CREATE TYPE "LoyaltyTransactionType" AS ENUM ('EARN', 'REDEEM', 'REFUND', 'REVERSAL', 'EXPIRE', 'ADJUST');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'AMOUNT', 'FREE');

-- CreateEnum
CREATE TYPE "PromotionAudience" AS ENUM ('ALL', 'MEMBERS');

-- CreateEnum
CREATE TYPE "PromotionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "LoyaltyRewardKind" AS ENUM ('POINTS', 'VISITS', 'BIRTHDAY');

-- CreateEnum
CREATE TYPE "MemberRewardStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'USED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DiscountUsageStatus" AS ENUM ('RESERVED', 'CONSUMED', 'RELEASED');

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "discountTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "originalPrice" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "services" ADD COLUMN     "membersOnly" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "birthDate" DATE,
ADD COLUMN     "notifyPromotions" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "loyalty_programs" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "joinRules" TEXT,
    "terms" TEXT,
    "pointsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pointsPerUnit" INTEGER NOT NULL DEFAULT 10,
    "amountPerUnit" INTEGER NOT NULL DEFAULT 1000,
    "pointsExpireDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_members" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "LoyaltyMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "pointsBalance" INTEGER NOT NULL DEFAULT 0,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statusChangedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_member_events" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_member_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_transactions" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "type" "LoyaltyTransactionType" NOT NULL,
    "points" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "appointmentId" TEXT,
    "memberRewardId" TEXT,
    "reason" TEXT,
    "actorId" TEXT,
    "expiresAt" TIMESTAMPTZ(3),
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_benefits" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "conditions" TEXT,
    "validFrom" TIMESTAMPTZ(3),
    "validUntil" TIMESTAMPTZ(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_benefits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_rewards" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "LoyaltyRewardKind" NOT NULL,
    "pointsCost" INTEGER,
    "visitsRequired" INTEGER,
    "discountType" "DiscountType" NOT NULL,
    "discountValue" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "validDays" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_reward_services" (
    "rewardId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,

    CONSTRAINT "loyalty_reward_services_pkey" PRIMARY KEY ("rewardId","serviceId")
);

-- CreateTable
CREATE TABLE "member_rewards" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "rewardId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "status" "MemberRewardStatus" NOT NULL DEFAULT 'AVAILABLE',
    "appointmentId" TEXT,
    "expiresAt" TIMESTAMPTZ(3),
    "unlockKey" TEXT NOT NULL,
    "expiryNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "audience" "PromotionAudience" NOT NULL DEFAULT 'ALL',
    "status" "PromotionStatus" NOT NULL DEFAULT 'DRAFT',
    "discountType" "DiscountType" NOT NULL,
    "discountValue" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMPTZ(3),
    "endsAt" TIMESTAMPTZ(3),
    "membersFrom" TIMESTAMPTZ(3),
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "maxUses" INTEGER,
    "maxUsesPerClient" INTEGER,
    "stackable" BOOLEAN NOT NULL DEFAULT false,
    "releaseOnCancel" BOOLEAN NOT NULL DEFAULT true,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_services" (
    "promotionId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,

    CONSTRAINT "promotion_services_pkey" PRIMARY KEY ("promotionId","serviceId")
);

-- CreateTable
CREATE TABLE "promotion_usages" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "userId" TEXT,
    "walkInClientId" TEXT,
    "status" "DiscountUsageStatus" NOT NULL DEFAULT 'RESERVED',
    "discountAmount" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotion_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_discounts" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "promotionId" TEXT,
    "memberRewardId" TEXT,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_discounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_audit_logs" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_programs_businessId_key" ON "loyalty_programs"("businessId");

-- CreateIndex
CREATE INDEX "loyalty_members_userId_idx" ON "loyalty_members"("userId");

-- CreateIndex
CREATE INDEX "loyalty_members_businessId_status_idx" ON "loyalty_members"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_members_businessId_userId_key" ON "loyalty_members"("businessId", "userId");

-- CreateIndex
CREATE INDEX "loyalty_member_events_memberId_createdAt_idx" ON "loyalty_member_events"("memberId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_transactions_idempotencyKey_key" ON "loyalty_transactions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "loyalty_transactions_memberId_createdAt_idx" ON "loyalty_transactions"("memberId", "createdAt");

-- CreateIndex
CREATE INDEX "loyalty_transactions_businessId_createdAt_idx" ON "loyalty_transactions"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "loyalty_benefits_businessId_idx" ON "loyalty_benefits"("businessId");

-- CreateIndex
CREATE INDEX "loyalty_rewards_businessId_idx" ON "loyalty_rewards"("businessId");

-- CreateIndex
CREATE INDEX "loyalty_reward_services_serviceId_idx" ON "loyalty_reward_services"("serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "member_rewards_unlockKey_key" ON "member_rewards"("unlockKey");

-- CreateIndex
CREATE INDEX "member_rewards_memberId_status_idx" ON "member_rewards"("memberId", "status");

-- CreateIndex
CREATE INDEX "member_rewards_businessId_idx" ON "member_rewards"("businessId");

-- CreateIndex
CREATE INDEX "promotions_businessId_status_idx" ON "promotions"("businessId", "status");

-- CreateIndex
CREATE INDEX "promotion_services_serviceId_idx" ON "promotion_services"("serviceId");

-- CreateIndex
CREATE INDEX "promotion_usages_promotionId_status_idx" ON "promotion_usages"("promotionId", "status");

-- CreateIndex
CREATE INDEX "promotion_usages_appointmentId_idx" ON "promotion_usages"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_usages_promotionId_appointmentId_key" ON "promotion_usages"("promotionId", "appointmentId");

-- CreateIndex
CREATE INDEX "appointment_discounts_appointmentId_idx" ON "appointment_discounts"("appointmentId");

-- CreateIndex
CREATE INDEX "loyalty_audit_logs_businessId_createdAt_idx" ON "loyalty_audit_logs"("businessId", "createdAt");

-- AddForeignKey
ALTER TABLE "loyalty_programs" ADD CONSTRAINT "loyalty_programs_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_members" ADD CONSTRAINT "loyalty_members_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_members" ADD CONSTRAINT "loyalty_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_member_events" ADD CONSTRAINT "loyalty_member_events_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "loyalty_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "loyalty_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_benefits" ADD CONSTRAINT "loyalty_benefits_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_rewards" ADD CONSTRAINT "loyalty_rewards_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_reward_services" ADD CONSTRAINT "loyalty_reward_services_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "loyalty_rewards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_reward_services" ADD CONSTRAINT "loyalty_reward_services_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_rewards" ADD CONSTRAINT "member_rewards_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "loyalty_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_rewards" ADD CONSTRAINT "member_rewards_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "loyalty_rewards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_rewards" ADD CONSTRAINT "member_rewards_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_services" ADD CONSTRAINT "promotion_services_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_services" ADD CONSTRAINT "promotion_services_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_usages" ADD CONSTRAINT "promotion_usages_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_usages" ADD CONSTRAINT "promotion_usages_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_discounts" ADD CONSTRAINT "appointment_discounts_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_audit_logs" ADD CONSTRAINT "loyalty_audit_logs_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Guards the database keeps on its own, whatever the code does: a points balance never
-- goes below zero and discounts stay within sensible bounds.
ALTER TABLE "loyalty_members" ADD CONSTRAINT "loyalty_members_points_non_negative" CHECK ("pointsBalance" >= 0);
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_discount_valid" CHECK ("discountValue" >= 0 AND ("discountType" <> 'PERCENT' OR "discountValue" <= 100));
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_limits_positive" CHECK (("maxUses" IS NULL OR "maxUses" > 0) AND ("maxUsesPerClient" IS NULL OR "maxUsesPerClient" > 0));
ALTER TABLE "loyalty_rewards" ADD CONSTRAINT "loyalty_rewards_discount_valid" CHECK ("discountValue" >= 0 AND ("discountType" <> 'PERCENT' OR "discountValue" <= 100));
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_discount_non_negative" CHECK ("discountTotal" >= 0 AND "price" >= 0);

-- Existing appointments were booked at the service's price, with no discount.
UPDATE "appointments" SET "originalPrice" = "price" WHERE "originalPrice" IS NULL;
