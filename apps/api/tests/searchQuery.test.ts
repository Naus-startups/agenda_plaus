import { describe, expect, it } from "vitest";
import { parseSearchQuery, searchableText, stemWord, termMatches } from "../src/shared/utils/textMatch";

function matches(query: string, text: string): boolean[] {
  const haystack = searchableText(text);
  return parseSearchQuery(query).map((term) => termMatches(term, haystack));
}

describe("pesquisa: ler o pedido da pessoa", () => {
  it("tira as palavras do pedido e fica com o que se procura", () => {
    expect(parseSearchQuery("Quero cortar o cabelo").map((term) => term.word)).toEqual(["cortar", "cabelo"]);
    expect(parseSearchQuery("preciso de fazer as unhas").map((term) => term.word)).toEqual(["unhas"]);
    expect(parseSearchQuery("quero fazer")).toEqual([]);
  });

  it("reduz as palavras ao radical, com ou sem acentos", () => {
    expect(stemWord("cortar")).toBe("cort");
    expect(stemWord("cortes")).toBe("cort");
    expect(stemWord("depilação")).toBe("depil");
    expect(stemWord("depilacao")).toBe("depil");
    expect(stemWord("unhas")).toBe("unha");
  });

  it("encontra o serviço escrito de outra forma", () => {
    expect(matches("quero cortar cabelo", "Corte de Cabelo")).toEqual([true, true]);
    expect(matches("quero cortar cabelo 2 tempos", "Corte 2 Tempos")).toEqual([true, false, true]);
    expect(matches("fazer as unhas", "Manicure e Pedicure")).toEqual([true]);
    expect(matches("trancas", "Tranças Box Braids")).toEqual([true]);
    expect(matches("maquiagem", "Maquilhagem para noivas")).toEqual([true]);
    expect(matches("depilação", "Depilacao a cera")).toEqual([true]);
  });

  it("só compara inícios de palavra", () => {
    expect(matches("spa", "O nosso espaço")).toEqual([false]);
  });

  it("dá padrões com acentos para a base de dados", () => {
    expect(parseSearchQuery("trancas")[0].patterns).toContain("tranç");
  });
});
