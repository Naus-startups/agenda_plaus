"""Downloads, per province, the named places OpenStreetMap has (prov/<relation id>.json).

Needs admin.json, Angola's admin boundaries (provinces = admin_level 4), saved from Overpass:
  [out:json][timeout:180];area["ISO3166-1"="AO"][admin_level=2]->.a;
  relation(area.a)["boundary"="administrative"]["admin_level"~"^(4|6)$"];out tags center;
build.py also reads geom.json, the old municipal/district boundaries with their geometry:
  [out:json][timeout:280];relation(id:<the admin_level 6 and 7 ids of the query above,
  and of the same query with "^(5|7|8)$">);out geom;
"""
import json, time, urllib.request, urllib.parse, os
# Overpass and Nominatim ask for an identifying User-Agent with a contact.
UA = os.environ.get('GEO_BUILD_USER_AGENT', 'agenda-plus-geo-build/1.0')
provs = [e for e in json.load(open('admin.json'))['elements'] if e['tags'].get('admin_level') == '4']
os.makedirs('prov', exist_ok=True)
for p in provs:
    path = f"prov/{p['id']}.json"
    if os.path.exists(path): continue
    q = f'[out:json][timeout:200];relation({p["id"]});map_to_area->.p;node(area.p)["place"~"^(city|town|village|suburb|quarter|neighbourhood)$"]["name"];out;'
    for attempt in range(6):
        try:
            req = urllib.request.Request("https://overpass-api.de/api/interpreter", data=urllib.parse.urlencode({'data': q}).encode(), headers={'User-Agent': UA})
            body = urllib.request.urlopen(req, timeout=240).read()
            data = json.loads(body)
            if data.get('remark'): raise Exception(data['remark'])
            json.dump({'province': p['tags'], 'id': p['id'], 'center': p.get('center'), 'elements': data['elements']}, open(path, 'w'), ensure_ascii=False)
            print(p['tags'].get('name'), len(data['elements']), flush=True)
            break
        except Exception as e:
            print('retry', p['tags'].get('name'), str(e)[:80], flush=True); time.sleep(10 * 2 ** attempt)
    time.sleep(3)
