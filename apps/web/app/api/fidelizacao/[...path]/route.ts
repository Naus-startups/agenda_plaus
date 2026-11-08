import { requireAuth } from "@/lib/auth";
import { proxyToApi } from "@/lib/api-proxy";
import { errorJson, errorResponse } from "@/lib/dashboard-api";

type Context = { params: Promise<{ path: string[] }> };

// Fidelização e benefícios do próprio espaço: o painel só chega às secções de fidelização
// do negócio da sessão (nunca a outro, nem a outra parte da API). Quem pode ver ou mudar
// cada coisa (dono ou equipa) é a API que decide, para cada pedido.
const SECTIONS = new Set(["program", "overview", "members", "benefits", "rewards", "promotions", "members-only-services"]);
const SEGMENT = /^[A-Za-z0-9-]{1,64}$/;

async function forward(request: Request, { params }: Context) {
  try {
    const user = await requireAuth();
    const { path } = await params;
    if (path.length === 0 || path.length > 3 || !SECTIONS.has(path[0]) || !path.every((segment) => SEGMENT.test(segment))) {
      return errorJson("Não encontrado.", 404);
    }
    return await proxyToApi(request, `/businesses/${user.businessId}/loyalty/${path.join("/")}`);
  } catch (error) {
    return errorResponse(error, "Não foi possível falar com o programa de fidelização.");
  }
}

export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE };
