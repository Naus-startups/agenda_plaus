import { z } from "zod";

// Emails are compared case-insensitively everywhere: "Ana@x.ao" and "ana@x.ao" are one person.
const email = z.string().trim().toLowerCase().email().max(254);
// The passwords tried first by anyone guessing (the top of the public leaked-password
// lists, plus local variants). Length alone lets "12345678" through.
const COMMON_PASSWORDS = new Set([
  "12345678", "123456789", "1234567890", "12341234", "87654321", "11111111", "00000000", "123123123",
  "password", "password1", "password12", "password123", "passw0rd", "qwerty123", "qwertyuiop", "1q2w3e4r",
  "abc12345", "abcd1234", "iloveyou", "admin123", "welcome1", "senha123", "senha1234", "palavrapasse",
  "agenda123", "slotix123", "angola123", "luanda123",
]);

// bcrypt only reads the first 72 bytes; the ceiling also keeps hashing cheap to refuse.
export const newPassword = z
  .string()
  .min(8)
  .max(128)
  .refine((value) => !COMMON_PASSWORDS.has(value.toLowerCase()), "Esta password é demasiado comum. Escolha outra.");
const password = newPassword;

// An ISO 8601 UTC timestamp, with or without seconds — what Zod 3's datetime() accepted.
// Zod 4's requires the seconds, so minute precision is allowed explicitly to keep the
// API contract unchanged.
// The metadata keeps the generated OpenAPI docs describing it as one date-time string.
export const isoDateTime = z.union([z.iso.datetime(), z.iso.datetime({ precision: -1 })]).meta({ type: "string", format: "date-time" });

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
});

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email,
  password,
  phone: z.string().trim().max(40).optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1).max(4000),
});

export const createAppointmentSchema = z.object({
  businessId: z.guid(),
  serviceId: z.guid(),
  professionalId: z.guid(),
  scheduledAt: isoDateTime,
  notes: z.string().max(1000).optional(),
});

export const rescheduleAppointmentSchema = z.object({
  scheduledAt: isoDateTime,
});

export const createFavoriteSchema = z.object({
  businessId: z.guid(),
});

export const createReviewSchema = z.object({
  appointmentId: z.guid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

export const paymentMethodSchema = z.enum(["CASH", "CARD", "MULTICAIXA", "BANK_TRANSFER", "OTHER"]);

export const createPaymentSchema = z.object({
  appointmentId: z.guid(),
  method: paymentMethodSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
export type RescheduleAppointmentInput = z.infer<typeof rescheduleAppointmentSchema>;
export type CreateFavoriteInput = z.infer<typeof createFavoriteSchema>;
export type CreateReviewInput = z.infer<typeof createReviewSchema>;
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
