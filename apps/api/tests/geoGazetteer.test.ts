import { describe, expect, it } from "vitest";
import { areaKey, gazetteer } from "../src/modules/geo/geo.gazetteer";

const LUANDA = { provincia: "Luanda", latitude: -8.84, longitude: 13.23 };

describe("divisão administrativa: os dados", () => {
  it("tem as 21 províncias e os 326 municípios da Lei n.º 14/24", () => {
    const provinces = gazetteer.provinces();
    expect(provinces).toHaveLength(21);
    expect(provinces.reduce((sum, province) => sum + (province.municipalityCount ?? 0), 0)).toBe(326);
  });

  it("a sede de cada província é um dos seus municípios", () => {
    for (const province of gazetteer.provinces()) {
      const names = gazetteer.municipalities(province.name)!.map((item) => item.name);
      expect(names).toContain(province.capital);
    }
  });

  it("não repete municípios numa província nem bairros num município", () => {
    for (const province of gazetteer.provinces()) {
      const municipalities = gazetteer.municipalities(province.name)!;
      expect(new Set(municipalities.map((item) => areaKey(item.name))).size).toBe(municipalities.length);
      for (const municipality of municipalities) {
        expect(new Set(municipality.bairros.map((item) => areaKey(item.name))).size).toBe(municipality.bairros.length);
      }
    }
  });

  it("os pontos ficam em Angola", () => {
    for (const province of gazetteer.provinces()) {
      for (const municipality of gazetteer.municipalities(province.name)!) {
        for (const point of [municipality, ...municipality.bairros]) {
          if (point.latitude === null || point.longitude === null) continue;
          expect(point.latitude).toBeGreaterThan(-18.1);
          expect(point.latitude).toBeLessThan(-4.3);
          expect(point.longitude).toBeGreaterThan(11.4);
          expect(point.longitude).toBeLessThan(24.1);
        }
      }
    }
  });

  it("encontra a província escrita de outras formas", () => {
    expect(gazetteer.municipalities("cuanza-norte")).not.toBeNull();
    expect(gazetteer.municipalities("Província de Ícolo e Bengo")).not.toBeNull();
    expect(gazetteer.municipalities("Kwanza Sul")).not.toBeNull();
    expect(gazetteer.municipalities("Cuando Cubango")).toBeNull();
  });

  it("a lista antiga de zonas junta municípios e bairros", () => {
    const zones = gazetteer.zones("Luanda")!.map((zone) => zone.name);
    expect(zones).toContain("Talatona");
    expect(zones).toContain("Alvalade");
  });
});

describe("divisão administrativa: os nomes oficiais de um ponto", () => {
  it("o bairro decide o município, mesmo que o mapa dê o município antigo", () => {
    expect(gazetteer.resolve({ ...LUANDA, municipio: "Luanda", bairro: "Alvalade" })).toEqual({
      provincia: "Luanda",
      municipio: "Maianga",
      bairro: "Alvalade",
    });
  });

  it("um bairro que passou a município é esse município", () => {
    expect(gazetteer.resolve({ ...LUANDA, municipio: "Belas", bairro: "Talatona" })).toEqual({
      provincia: "Luanda",
      municipio: "Talatona",
      bairro: null,
    });
  });

  it("um distrito urbano que passou a município é esse município", () => {
    expect(
      gazetteer.resolve({ ...LUANDA, municipio: "Luanda", distrito: "Distrito Urbano da Maianga", bairro: "Rua Sem Nome" }),
    ).toMatchObject({ municipio: "Maianga", bairro: "Rua Sem Nome" });
  });

  it("aceita o nome do município como o mapa o escreve", () => {
    expect(gazetteer.resolve({ ...LUANDA, municipio: "Município do Cazenga", bairro: null })).toMatchObject({ municipio: "Cazenga" });
  });

  it("sem nome que sirva, fica o município mais perto do ponto", () => {
    expect(
      gazetteer.resolve({ provincia: "Huambo", municipio: null, bairro: null, latitude: -12.85, longitude: 15.56 }),
    ).toMatchObject({ provincia: "Huambo", municipio: "Caála" });
  });

  it("fora das províncias conhecidas deixa tudo como veio", () => {
    expect(gazetteer.resolve({ provincia: "Erongo", municipio: "Swakopmund", bairro: null, latitude: -22.6, longitude: 14.5 })).toEqual({
      provincia: "Erongo",
      municipio: "Swakopmund",
      bairro: null,
    });
  });
});
