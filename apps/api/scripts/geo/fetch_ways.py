import json, time, urllib.request, urllib.parse, os
# Overpass and Nominatim ask for an identifying User-Agent with a contact.
UA = os.environ.get('GEO_BUILD_USER_AGENT', 'agenda-plus-geo-build/1.0')
provs = [e for e in json.load(open('admin.json'))['elements'] if e['tags'].get('admin_level') == '4']
os.makedirs('provw', exist_ok=True)
for p in provs:
    path = f"provw/{p['id']}.json"
    if os.path.exists(path): continue
    q = f'[out:json][timeout:200];relation({p["id"]});map_to_area->.p;(way(area.p)["place"~"^(suburb|quarter|neighbourhood|village|town)$"]["name"];relation(area.p)["place"~"^(suburb|quarter|neighbourhood|village|town)$"]["name"];way(area.p)["landuse"="residential"]["name"];);out tags center;'
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
