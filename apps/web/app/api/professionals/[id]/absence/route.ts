import { requireAuth } from "@/lib/auth";
import { proxyToApi } from "@/lib/api-proxy";
import { errorJson, errorResponse } from "@/lib/dashboard-api";

type Context = { params: Promise<{ id: string }> };

// "Ausente hoje" (POST) e "Presente" (DELETE). A API só deixa o dono do espaço ou o próprio
// profissional fazê-lo.
async function forward(request: Request, { params }: Context) {
  try {
    await requireAuth();
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return errorJson("Profissional não encontrado.", 404);
    return await proxyToApi(request, `/professionals/${id}/absence`);
  } catch (error) {
    return errorResponse(error, "Não foi possível alterar a presença.");
  }
}

export { forward as POST, forward as DELETE };
