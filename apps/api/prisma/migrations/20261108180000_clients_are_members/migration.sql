-- Ser cliente do espaço é estar no seu programa de fidelização: os clientes que já
-- existiam passam a ter a sua adesão, com a data em que se tornaram clientes. Quem o
-- dono já suspendeu ou removeu fica como está (a linha já existe e não é tocada).
INSERT INTO "loyalty_members" ("id", "businessId", "userId", "status", "plan", "pointsBalance", "joinedAt", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, bc."businessId", bc."userId", 'ACTIVE', 'FREE', 0, bc."createdAt", NOW(), NOW()
FROM "business_clients" bc
ON CONFLICT ("businessId", "userId") DO NOTHING;

INSERT INTO "loyalty_member_events" ("id", "memberId", "action", "reason", "actorId", "createdAt")
SELECT gen_random_uuid()::text, m."id", 'JOINED', 'Cliente do espaço', NULL, m."joinedAt"
FROM "loyalty_members" m
WHERE NOT EXISTS (SELECT 1 FROM "loyalty_member_events" e WHERE e."memberId" = m."id");

-- Quem tinha saído do programa mas continua cliente volta a ter os benefícios.
UPDATE "loyalty_members" m SET "status" = 'ACTIVE', "statusChangedAt" = NOW()
WHERE m."status" = 'LEFT'
  AND EXISTS (SELECT 1 FROM "business_clients" bc WHERE bc."businessId" = m."businessId" AND bc."userId" = m."userId");
