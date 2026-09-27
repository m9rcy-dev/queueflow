import { z } from "zod";

export const createServiceSchema = z.object({
  locationId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  durationMinutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60),
  queueEnabled: z.boolean().optional(),
  appointmentEnabled: z.boolean().optional(),
  displayOrder: z.number().int().min(0).optional(),
});
export type CreateServiceInput = z.infer<typeof createServiceSchema>;

export const updateServiceSchema = createServiceSchema
  .omit({ locationId: true })
  .partial()
  .extend({ active: z.boolean().optional() });
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;

export const listServicesQuerySchema = z.object({
  locationId: z.string().uuid().optional(),
});
export type ListServicesQuery = z.infer<typeof listServicesQuerySchema>;
