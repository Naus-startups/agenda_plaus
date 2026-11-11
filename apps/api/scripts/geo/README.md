# Divisão administrativa de Angola (`src/modules/geo/data/angola.json`)

O ficheiro que a API usa para províncias, municípios e bairros. É gerado por estes
scripts e depois revisto à mão; a API só o lê (nunca pergunta isto ao OpenStreetMap em
tempo real).

## De onde vem cada coisa

| Nível | Fonte | Notas |
| --- | --- | --- |
| 21 províncias, 326 municípios, sede de cada província | **Lei n.º 14/24, de 5 de Setembro** (Diário da República n.º 171), quadros-resumo do anexo | `parse.py` confere os totais de cada província com os da lei |
| Ponto (sede) de cada município | OpenStreetMap: povoação com o mesmo nome na província; senão Nominatim, Photon, ou nome aproximado (≥ 0,85) | ~30 municípios novos (antigas comunas) ainda ficam sem ponto (`latitude: null`) |
| Bairros | OpenStreetMap: `place=suburb/quarter/neighbourhood/village/town` e áreas `landuse=residential` com nome; mais `extra-bairros.json` (bairros conhecidos de Luanda que o OSM não tem como "place") | Sem condomínios, quarteirões, fazendas nem nomes comerciais |

**Bairro → município.** O OSM quase não tem limites dos municípios novos. Cada bairro vai
para a sede mais próxima **dentro do mesmo limite antigo** que o OSM tem (os distritos
urbanos e municípios antigos de Luanda, alguns da Huíla) — um município novo saiu sempre
de um antigo. É uma aproximação: em Luanda está certa na grande maioria dos casos, mas um
bairro na fronteira pode ficar no município vizinho.

## Regenerar

Num diretório temporário (os scripts leem e escrevem no diretório atual). Os servidores do
OpenStreetMap pedem que quem pergunta se identifique: `export GEO_BUILD_USER_AGENT="agenda-plus-geo-build/1.0 (email de contacto)"`.

```sh
# 1. A lei (PDF de ~30 MB) e os quadros-resumo
curl -L -o lei.pdf https://mpla.ao/wp-content/uploads/2024/09/Lei14.24de5deSetembro.pdf
pdftotext -layout lei.pdf lei.txt
python3 parse.py                      # → raw.json

# 2. OpenStreetMap (Overpass): limites, pontos e áreas de cada província
#    admin.json: relações admin_level 4 e 6; admin2.json: níveis 5, 7, 8
#    (a consulta está no topo de fetch_prov.py; geom.json: as relações 6/7 com "out geom")
python3 fetch_prov.py                 # → prov/<id>.json  (pontos)
python3 fetch_ways.py                 # → provw/<id>.json (áreas)

# 3. Juntar tudo
python3 build.py                      # → angola-full.json (lista o que ficou sem ponto)
python3 emit.py <repo>/apps/api/src/modules/geo/data/angola.json AAAA-MM-DD
```

O Overpass público recusa pedidos quando está cheio (502/504): os scripts esperam e
tentam outra vez. O Nominatim é pedido a 1 por segundo e as respostas ficam em cache
local (`geocache2.json`, `photoncache.json`).

## Corrigir à mão

O JSON tem um bairro por linha para as correções serem diffs de uma linha:

- **Município sem ponto**: preencher `latitude`/`longitude` com a sede.
- **Bairro no município errado**: mover a linha para o município certo.
- **Bairro em falta**: acrescentar a linha (nome, latitude, longitude), por ordem alfabética.

Depois `npm test` na API: `tests/geoGazetteer.test.ts` confirma 21 províncias, 326
municípios, sedes válidas, nada repetido e todos os pontos dentro de Angola.

Os dados do OpenStreetMap são © contribuidores do OpenStreetMap, licença ODbL.
