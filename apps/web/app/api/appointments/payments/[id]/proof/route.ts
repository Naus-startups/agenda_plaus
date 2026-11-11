import type { PaymentDTO } from "@slotix/types";
import { requireStaff } from "@/lib/auth";
import { apiProxyFetch } from "@/lib/api-proxy";
import { apiCall, errorJson, errorResponse } from "@/lib/dashboard-api";

// `id` is the appointment's id, as for the receipt. The proof carries bank details, so it
// is never stored with a public URL: the file is read from the API on every request.
async function paymentOf(appointmentId: string, businessId: string): Promise<PaymentDTO | null> {
  const payment = await apiCall<PaymentDTO>(`/appointments/${encodeURIComponent(appointmentId)}/payment`);
  return payment.businessId === businessId ? payment : null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireStaff();
    const { id } = await params;

    const payment = await paymentOf(id, user.businessId);
    if (!payment) return errorJson("Pagamento não encontrado.", 404);
    if (!payment.proof) return errorJson("Este pagamento não tem comprovativo.", 404);

    const response = await apiProxyFetch(`/payments/${payment.id}/proof`);
    if (!response.ok) {
      const json = await response.json().catch(() => null);
      return errorJson(json?.error?.message ?? "Não foi possível abrir o comprovativo.", response.status, { code: json?.error?.code });
    }

    return new Response(response.body, {
      headers: {
        "Content-Type": response.headers.get("Content-Type") ?? payment.proof.mimeType,
        "Content-Disposition": response.headers.get("Content-Disposition") ?? "inline",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return errorResponse(error, "Não foi possível abrir o comprovativo.");
  }
}

// Attaching the proof to a payment received without one (an existing one is never replaced).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireStaff();
    const { id } = await params;

    const formData = await request.formData().catch(() => null);
    const proof = formData?.get("proof");
    if (!(proof instanceof File) || proof.size === 0) return errorJson("Selecione o comprovativo.", 400);

    const payment = await paymentOf(id, user.businessId);
    if (!payment) return errorJson("Pagamento não encontrado.", 404);

    const upload = new FormData();
    upload.append("proof", proof, proof.name);
    const updated = await apiCall<PaymentDTO>(`/payments/${payment.id}/proof`, { method: "POST", body: upload });

    return Response.json({ success: true, proof: updated.proof }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Não foi possível guardar o comprovativo.");
  }
}
