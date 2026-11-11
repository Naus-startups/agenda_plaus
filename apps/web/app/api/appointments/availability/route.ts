import type { AvailabilitySlotDTO } from "@slotix/types";
import { requireStaff } from "@/lib/auth";
import { apiCall, errorJson, errorResponse, localTime } from "@/lib/dashboard-api";

// The free start times for a service with a professional on a day — the same list the app
// offers its clients, so a booking made here passes the API's checks exactly as one made there.
export async function GET(request: Request) {
  try {
    const user = await requireStaff();
    const params = new URL(request.url).searchParams;
    const serviceId = params.get("serviceId")?.trim() ?? "";
    const professionalId = params.get("professionalId")?.trim() ?? "";
    const date = params.get("date")?.trim() ?? "";

    if (!serviceId || !professionalId || !date) return errorJson("Selecione o serviço, o profissional e a data.", 400);

    const query = new URLSearchParams({ businessId: user.businessId, serviceId, professionalId, date });
    const slots = await apiCall<AvailabilitySlotDTO[]>(`/availability?${query}`);

    return Response.json(
      { success: true, times: slots.map((slot) => localTime(new Date(slot.time))) },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
    );
  } catch (error) {
    return errorResponse(error, "Não foi possível carregar os horários livres.");
  }
}
