import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/database";
import { requireId } from "../../shared/utils/requireId";

// No payment row, or one that was never paid (pending, failed, refunded).
const UNPAID = { OR: [{ payment: { is: null } }, { payment: { is: { status: { not: "PAID" as const } } } }] };

export const notificationsRepository = {
  create(data: { userId: string; type: string; title: string; message: string }) {
    return prisma.notification.create({ data });
  },

  exists(userId: string, type: string, message: string) {
    return prisma.notification.findFirst({ where: { userId, type, message }, select: { id: true } }).then(Boolean);
  },

  // Agendamentos de clientes com conta que ainda não foram concluídos nem cancelados, com
  // o que é preciso para escrever o aviso (ver appointmentReminders.ts).
  findAppointmentsAwaitingReminders(from: Date, to: Date) {
    return prisma.appointment.findMany({
      where: {
        clientId: { not: null },
        status: { in: ["PENDING", "CONFIRMED"] },
        scheduledAt: { gte: from, lte: to },
      },
      select: {
        id: true,
        clientId: true,
        scheduledAt: true,
        durationMinutes: true,
        business: { select: { name: true } },
        service: { select: { name: true } },
      },
    });
  },

  // Still open (nobody completed, cancelled or marked it) and booked before `before`.
  // Still open (pending or confirmed) and with no payment received: what the no-show
  // rule looks at. One already paid is left alone, even if nobody marked it done.
  findOpenUnpaidAppointmentsBefore(before: Date) {
    return prisma.appointment.findMany({
      where: { status: { in: ["PENDING", "CONFIRMED"] }, scheduledAt: { lt: before }, ...UNPAID },
      select: {
        id: true,
        clientId: true,
        scheduledAt: true,
        business: { select: { name: true, ownerId: true } },
        service: { select: { name: true } },
        professional: { select: { userId: true } },
        client: { select: { name: true } },
        walkInClient: { select: { name: true } },
      },
    });
  },

  // Only if it is still open and unpaid: staff may have completed, cancelled or charged it
  // meanwhile. Its promotional slots and rewards are given back in the same transaction.
  markNoShowIfUnpaid(id: string, release: (db: Prisma.TransactionClient) => Promise<void>): Promise<boolean> {
    return prisma.$transaction(async (db) => {
      const { count } = await db.appointment.updateMany({
        where: { id, status: { in: ["PENDING", "CONFIRMED"] }, ...UNPAID },
        data: { status: "NO_SHOW" },
      });
      if (count > 0) await release(db);
      return count > 0;
    });
  },

  async acceptsPromotions(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { notifyPromotions: true, deletedAt: true } });
    return Boolean(user && !user.deletedAt && user.notifyPromotions);
  },

  // Who to tell about an appointment on the business side, and what to tell them.
  findAppointmentForNotice(id: string) {
    return prisma.appointment.findUnique({
      where: { id },
      select: {
        scheduledAt: true,
        client: { select: { name: true } },
        service: { select: { name: true } },
        professional: { select: { userId: true } },
        business: { select: { name: true, ownerId: true } },
      },
    });
  },

  savePushToken(userId: string, token: string) {
    return prisma.pushToken.upsert({ where: { token }, create: { userId, token }, update: { userId } });
  },

  deletePushToken(userId: string, token: string) {
    return prisma.pushToken.deleteMany({ where: { userId: requireId(userId, "userId"), token } });
  },

  deletePushTokens(tokens: string[]) {
    return prisma.pushToken.deleteMany({ where: { token: { in: tokens } } });
  },

  findPushTokens(userId: string) {
    return prisma.pushToken.findMany({ where: { userId: requireId(userId, "userId") }, select: { token: true } }).then((rows) => rows.map((row) => row.token));
  },

  findByUser(userId: string) {
    return prisma.notification.findMany({ where: { userId: requireId(userId, "userId") }, orderBy: { createdAt: "desc" } });
  },

  findById(id: string) {
    return prisma.notification.findUnique({ where: { id } });
  },

  markRead(id: string) {
    return prisma.notification.update({ where: { id }, data: { read: true } });
  },

  markAllRead(userId: string) {
    return prisma.notification.updateMany({ where: { userId: requireId(userId, "userId"), read: false }, data: { read: true } });
  },
};
