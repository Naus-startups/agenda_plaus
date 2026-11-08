import { z } from "zod";
import { newPassword } from "@slotix/validation";
import { imageUrl, personName, phone } from "../../shared/validation/fields";

export const updateProfileSchema = z.object({
  name: personName.optional(),
  phone: phone.optional(),
  avatarUrl: imageUrl.optional(),
  // For birthday rewards; a real past date, or null to remove it.
  birthDate: z.iso
    .date()
    .refine((value) => Date.parse(value) < Date.now() && Date.parse(value) > Date.parse("1900-01-01"), "Data de nascimento inválida.")
    .nullable()
    .optional(),
  notifyPromotions: z.boolean().optional(),
});

export const updateLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword,
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
