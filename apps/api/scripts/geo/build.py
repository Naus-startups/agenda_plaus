"""Builds Angola's administrative gazetteer: official provinces/municípios (Lei 14/24)
with coordinates and bairros from OpenStreetMap."""
import difflib
import json, glob, re, math, unicodedata, sys, os, time, urllib.request, urllib.parse

def strip_accents(s): return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')
def norm(s): return re.sub(r'\s+', ' ', strip_accents(s).lower().replace('-', ' ').replace("'", '').replace('’', '')).strip()
def key(s):
    k = re.sub(r'[^a-z]', '', norm(s))
    for a, b in [('qu', 'c'), ('k', 'c'), ('w', 'u'), ('y', 'i'), ('ss', 's'), ('ch', 'x'), ('z', 's'), ('j', 'g'), ('h', '')]:
        k = k.replace(a, b)
    return k
def km(a, b):
    r = math.radians; dl = r(b[0]-a[0]); dg = r(b[1]-a[1])
    h = math.sin(dl/2)**2 + math.cos(r(a[0]))*math.cos(r(b[0]))*math.sin(dg/2)**2
    return 6371*2*math.atan2(math.sqrt(h), math.sqrt(1-h))

# Display names: the law's names, as the app already writes the provinces.
PROVINCE_NAMES = {
    'CABINDA': 'Cabinda', 'ZAIRE': 'Zaire', 'UÍGE': 'Uíge', 'BENGO': 'Bengo', 'LUANDA': 'Luanda',
    'ICOLO E BENGO': 'Icolo e Bengo', 'CUANZA - NORTE': 'Cuanza Norte', 'CUANZA - SUL': 'Cuanza Sul',
    'MALANJE': 'Malanje', 'LUNDA - NORTE': 'Lunda Norte', 'LUNDA - SUL': 'Lunda Sul', 'MOXICO': 'Moxico',
    'MOXICO LESTE': 'Moxico Leste', 'BIÉ': 'Bié', 'HUAMBO': 'Huambo', 'BENGUELA': 'Benguela', 'NAMIBE': 'Namibe',
    'HUÍLA': 'Huíla', 'CUNENE': 'Cunene', 'CUBANGO': 'Cubango', 'CUANDO': 'Cuando',
}
# The seat of each province (Lei 14/24, art. 2.º): a município of that province.
CAPITALS = {
    'Cabinda': 'Cabinda', 'Zaire': 'Mbanza Kongo', 'Uíge': 'Uíge', 'Bengo': 'Dande', 'Luanda': 'Ingombota',
    'Icolo e Bengo': 'Catete', 'Cuanza Norte': 'Cazengo', 'Cuanza Sul': 'Sumbe', 'Malanje': 'Malanje',
    'Lunda Norte': 'Dundo', 'Lunda Sul': 'Saurimo', 'Moxico': 'Luena', 'Moxico Leste': 'Cazombo', 'Bié': 'Cuito',
    'Huambo': 'Huambo', 'Benguela': 'Benguela', 'Namibe': 'Moçâmedes', 'Huíla': 'Lubango', 'Cunene': 'Cuanhama',
    'Cubango': 'Menongue', 'Cuando': 'Mavinga',
}
# Seats known in OpenStreetMap under another name.
SEAT_ALIASES = {
    ('Bengo', 'Dande'): ['Caxito'], ('Cuanza Norte', 'Cazengo'): ['Ndalatando', "N'dalatando"],
    ('Cunene', 'Cuanhama'): ['Ondjiva', 'Ondjiva'], ('Cuanza Sul', 'Calulo'): ['Calulo'],
    ('Cuanza Sul', 'Gabela'): ['Gabela'], ('Cuanza Sul', 'Waku Kungo'): ['Waku-Kungo', 'Cela'],
    ('Huambo', 'Cachiungo'): ['Katchiungo'], ('Huambo', 'Ecunha'): ['Ekunha'], ('Namibe', 'Tômbwa'): ['Tombua'],
    ('Bengo', 'Quibaxe'): ['Quibaxe', 'Dembos'], ('Cabinda', 'Cacongo'): ['Lândana', 'Landana'],
    ('Malanje', 'Pungu a Ndongo'): ['Pungo Andongo'], ('Huíla', 'Jamba Mineira'): ['Jamba'],
    ('Bié', 'Nharêa'): ["N'harea"], ('Cunene', 'Curoca'): ['Oncócua'], ('Cuanza Norte', 'Ngonguembo'): ['Gonguembo', 'Camame'],
}
# Before 2024, OpenStreetMap (and Nominatim) filed these provinces' places under the old ones.
OLD_PARENT = {'Icolo e Bengo': ['Luanda', 'Bengo'], 'Cuando': ['Cuando Cubango', 'Cuando-Cubango', 'Cubango'], 'Cubango': ['Cuando Cubango', 'Cuando-Cubango', 'Cuando'],
              'Moxico Leste': ['Moxico'], 'Moxico': ['Moxico Leste']}
MARKETING = re.compile(r'residen|park\b|boulevard|clandestin|\bvill[ea]\b|\b(gold|blue|diamonte|plaza|garden|residence|towers?|village)\b|^(talatona|kilamba|camama|viana)\s', re.I)
PLACE_RANK = {'city': 0, 'town': 1, 'village': 2, 'suburb': 3, 'quarter': 4, 'neighbourhood': 5}
# Not bairros: housing blocks and condominiums (Luanda has hundreds), farms, landmarks.
JUNK = re.compile(r'^(quarteir[aã]o|bloco|lote|pr[eé]dio|edif[ií]cio|fazenda|bacia|zona industrial|parque industrial|condom[ií]n|complexo|residencial|resid[eê]ncia|pal[aá]cio|distrito|sector|setor|torre|vivenda|centralidade d[eo] ?$)|\?', re.I)

def province_of(tags):
    n = (tags.get('name:pt') or tags.get('name') or '')
    n = re.sub(r'^prov[ií]ncia\s+(de|do|da)\s+', '', unicodedata.normalize('NFC', n), flags=re.I)
    return n

law = json.load(open('raw.json'))
osm = {}
for f in glob.glob('prov/*.json'):
    d = json.load(open(f)); name = province_of(d['province'])
    w = json.load(open(f.replace('prov/', 'provw/')))
    osm[key(name)] = {'center': d['center'], 'nodes': d['elements'], 'areas': w['elements']}

def coords(e):
    if 'lat' in e: return (e['lat'], e['lon'])
    if 'center' in e: return (e['center']['lat'], e['center']['lon'])
    return None

geocache = json.load(open('geocache2.json')) if os.path.exists('geocache2.json') else {}
def nominatim(q):
    if q in geocache: return geocache[q]
    time.sleep(1.1)
    url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode({'q': q, 'countrycodes': 'ao', 'format': 'jsonv2', 'limit': 1, 'addressdetails': 1})
    req = urllib.request.Request(url, headers={'User-Agent': os.environ.get('GEO_BUILD_USER_AGENT', 'agenda-plus-geo-build/1.0')})
    try: r = json.loads(urllib.request.urlopen(req, timeout=30).read())
    except Exception as e: print('nominatim fail', q, e, file=sys.stderr); return None
    geocache[q] = [float(r[0]['lat']), float(r[0]['lon']), r[0].get('address', {}).get('state', ''), r[0].get('addresstype', '')] if r else None
    json.dump(geocache, open('geocache2.json', 'w'), ensure_ascii=False, indent=0)
    return geocache[q]

phcache = json.load(open('photoncache.json')) if os.path.exists('photoncache.json') else {}
def photon(q):
    if q in phcache: return phcache[q]
    time.sleep(1)
    url = 'https://photon.komoot.io/api?' + urllib.parse.urlencode({'q': q, 'limit': 5, 'bbox': '11.4,-18.1,24.1,-4.3'})
    req = urllib.request.Request(url, headers={'User-Agent': os.environ.get('GEO_BUILD_USER_AGENT', 'agenda-plus-geo-build/1.0')})
    try: phcache[q] = json.loads(urllib.request.urlopen(req, timeout=30).read()).get('features', [])
    except Exception as e: print('photon fail', q, e, file=sys.stderr); return []
    json.dump(phcache, open('photoncache.json', 'w'), ensure_ascii=False)
    return phcache[q]

# The old municipal / district boundaries OpenStreetMap has (Luanda's, a few in Huíla).
# Each new município was carved out of an old one, so a place may only go to a new
# município whose seat lies inside the same old boundary.
POLYS = []
for r in json.load(open('geom.json'))['elements']:
    edges = []
    for m in r.get('members', []):
        g = m.get('geometry') or []
        edges += [((a['lat'], a['lon']), (b['lat'], b['lon'])) for a, b in zip(g, g[1:])]
    if not edges: continue
    lats = [p[0] for e in edges for p in e]; lons = [p[1] for e in edges for p in e]
    POLYS.append({'name': r['tags'].get('name'), 'edges': edges, 'bbox': (min(lats), max(lats), min(lons), max(lons)),
                  'area': (max(lats) - min(lats)) * (max(lons) - min(lons))})
POLYS.sort(key=lambda p: p['area'])
def old_area(pt):
    lat, lon = pt
    for p in POLYS:
        a, b, c, d = p['bbox']
        if not (a <= lat <= b and c <= lon <= d): continue
        inside = False
        for (y1, x1), (y2, x2) in p['edges']:
            if (y1 > lat) != (y2 > lat) and lon < x1 + (lat - y1) * (x2 - x1) / (y2 - y1): inside = not inside
        if inside: return p['name']
    return None

EXTRA = json.load(open('extra-bairros.json'))
out, report = [], []
for p in law:
    pname = PROVINCE_NAMES[p['prov']]
    data = osm[key(pname)]
    places = []
    for e in data['nodes'] + data['areas']:
        c = coords(e); n = unicodedata.normalize('NFC', (e['tags'].get('name:pt') or e['tags'].get('name') or '').strip())
        if c and n: places.append({'name': n, 'kind': e['tags'].get('place') or 'residential', 'pt': c})
    municipios = []
    for m in p['munis']:
        names = [m] + SEAT_ALIASES.get((pname, m), [])
        cands = [pl for pl in places if any(key(pl['name']) == key(n) for n in names) and pl['kind'] in PLACE_RANK]
        cands.sort(key=lambda pl: PLACE_RANK[pl['kind']])
        pt, src = None, None
        if cands: pt, src = cands[0]['pt'], 'osm:' + cands[0]['kind']
        if not pt:
            for n in names:
                r = nominatim(f'{n}, {pname}, Angola')
                # Only a place itself, inside this province: not the province's own centre.
                if r and key(province_of({'name': r[2]})) in {key(pname), *map(key, OLD_PARENT.get(pname, []))} and r[3] not in ('state', 'province', 'region', 'country', 'river', 'stream', 'waterway'):
                    pt, src = r[:2], 'nominatim:' + r[3]; break
        if not pt:
            for n in names:
                for r in photon(f'{n} {pname}'):
                    pr = r['properties']
                    if pr.get('countrycode', '').upper() != 'AO' or pr.get('type') in ('state', 'country', 'county') or pr.get('osm_key') in ('waterway', 'natural', 'highway'): continue
                    if key(province_of({'name': pr.get('state', '')})) not in {key(pname), *map(key, OLD_PARENT.get(pname, []))}: continue
                    if difflib.SequenceMatcher(None, key(pr.get('name', '')), key(n)).ratio() < 0.85: continue
                    lon, lat = r['geometry']['coordinates']; pt, src = (lat, lon), 'photon:' + pr.get('osm_value', '') + ':' + pr.get('name', ''); break
                if pt: break
        if not pt:
            # Spelling varies a lot ("Quêssua"/"Quessua", "Kiwaba Nzoji"/"Kiuaba N'Zoji"): closest
            # town or village of the province, only when the names are clearly the same.
            pool = [pl for pl in places if pl['kind'] in ('city', 'town', 'village')]
            best = max(pool, key=lambda pl: difflib.SequenceMatcher(None, key(pl['name']), key(m)).ratio(), default=None)
            if best and difflib.SequenceMatcher(None, key(best['name']), key(m)).ratio() >= 0.85:
                pt, src = best['pt'], 'osm-fuzzy:' + best['name']
        if not pt: report.append(f'SEM PONTO: {pname} / {m}')
        municipios.append({'name': m, 'latitude': round(pt[0], 5) if pt else None, 'longitude': round(pt[1], 5) if pt else None, 'src': src, 'bairros': {}})
    # Well-known bairros that OpenStreetMap doesn't have as places: located by the geocoder,
    # kept only when found inside this province as a populated place.
    for n in EXTRA.get(pname, []):
        if any(key(pl['name']) == key(n) for pl in places): continue
        r = nominatim(f'{n}, {pname}, Angola')
        if r and key(province_of({'name': r[2]})) in {key(pname), *map(key, OLD_PARENT.get(pname, []))} and r[3] not in ('state', 'province', 'county', 'river', 'stream', 'landfill', 'railway', 'secondary', 'primary', 'trunk', 'tertiary', 'construction', 'cape', 'island', 'aeroway'):
            places.append({'name': n, 'kind': 'suburb', 'pt': (r[0], r[1])})
        else: report.append(f'BAIRRO EXTRA NÃO ENCONTRADO: {pname} / {n} ({r[3] if r else "-"})')
    seats = [mu for mu in municipios if mu['latitude'] is not None]
    for mu in seats: mu['area'] = old_area((mu['latitude'], mu['longitude']))
    taken = {key(mu['name']) for mu in municipios} | {key(pname)}
    taken |= {key(a) for (pp, _), al in SEAT_ALIASES.items() if pp == pname for a in al}
    # Places: nearest municipal seat of this province.
    seen_all = {}
    for pl in sorted(places, key=lambda pl: PLACE_RANK.get(pl['kind'], 9)):
        n = re.sub(r'\s+', ' ', pl['name'])
        if JUNK.search(n) or len(n) < 3 or not re.search(r'[A-Za-zÀ-ú]', n): continue
        stripped = re.sub(r'^(Bairro|Urbaniza[çc][ãa]o)\s+(d[aeo]s?\s+)?', '', n)
        if stripped != n and stripped[:1].isupper() and len(stripped) > 2: n_final = stripped
        else: n_final = n
        if n_final != n and n_final != pl['name'] and key(n_final) in seen_all: continue
        # Named residential areas are villages in the provinces, but in Luanda mostly
        # condominiums sold under English or brand names: those aren't bairros.
        if pl['kind'] == 'residential' and MARKETING.search(n_final): continue
        if key(n_final) in seen_all: continue
        if key(n_final) in taken or len(n_final) < 3 or n_final.isupper() and len(n_final) <= 4: continue
        area = old_area(pl['pt'])
        pool = [mu for mu in seats if mu['area'] == area] if area else []
        home = min(pool or seats, key=lambda mu: km(pl['pt'], (mu['latitude'], mu['longitude'])))
        k = key(n_final)
        b = home['bairros']
        if k in b: continue
        seen_all[k] = True
        b[k] = {'name': n_final, 'latitude': round(pl['pt'][0], 5), 'longitude': round(pl['pt'][1], 5)}
    for mu in municipios:
        mu.pop('area', None)
        mu['bairros'] = sorted(mu['bairros'].values(), key=lambda b: norm(b['name']))
    capital = next(mu for mu in municipios if key(mu['name']) == key(CAPITALS[pname]))
    out.append({'name': pname, 'capital': capital['name'], 'latitude': round(data['center']['lat'], 5), 'longitude': round(data['center']['lon'], 5),
                'municipios': sorted(municipios, key=lambda mu: norm(mu['name']))})

out.sort(key=lambda p: norm(p['name']))
json.dump(out, open('angola-full.json', 'w'), ensure_ascii=False, indent=1)
print('\n'.join(report))
from collections import Counter
print(Counter(mu['src'] for p in out for mu in p['municipios']))
print('bairros', sum(len(mu['bairros']) for p in out for mu in p['municipios']))
