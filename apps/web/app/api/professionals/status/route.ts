import { requireAuth } from "@/lib/auth";
import { proxyToApi } from "@/lib/api-proxy";
import { errorResponse } from "@/lib/dashboard-api";

// O estado de cada profissional do espaço agora (livre, a atender, ausente, fora do horário).
export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    return await proxyToApi(request, `/businesses/${user.businessId}/professionals/status`);
  } catch (error) {
    return errorResponse(error, "Não foi possível ver o estado da equipa.");
  }
}
