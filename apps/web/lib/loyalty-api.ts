// Pedidos do painel à fidelização (app/api/fidelizacao/**), que devolve o envelope da API
// ({ success, data } ou { success: false, error: { message } }). Lança um Error com a
// mensagem que a API deu, para a página a mostrar como está.
export async function loyaltyFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`/api/fidelizacao/${path}`, {
    method: init.method ?? "GET",
    headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "include",
    cache: "no-store",
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || json?.success === false) {
    const message = json?.error?.message ?? json?.error ?? "Não foi possível concluir o pedido.";
    throw new Error(typeof message === "string" ? message : "Não foi possível concluir o pedido.");
  }
  return (json?.data ?? json) as T;
}

export function formatKz(value: number): string {
  return `${value.toLocaleString("pt-PT", { maximumFractionDigits: 2 })} Kz`;
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}

export function discountText(type: "PERCENT" | "AMOUNT" | "FREE", value: number): string {
  if (type === "FREE") return "Grátis";
  if (type === "PERCENT") return `${value}%`;
  return formatKz(value);
}
