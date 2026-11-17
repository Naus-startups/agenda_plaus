"""Writes the gazetteer the API ships: angola-full.json without the build's bookkeeping,
one bairro per line so a correction shows up as a one-line diff."""
import json, sys
full = json.load(open('angola-full.json'))
d = lambda o: json.dumps(o, ensure_ascii=False)
lines = ['{', '  "source": "Províncias e municípios: Lei n.º 14/24, de 5 de Setembro (Divisão Político-Administrativa). Coordenadas e bairros: © OpenStreetMap (ODbL).",',
         f'  "generatedAt": "{sys.argv[2]}",', '  "provinces": [']
for i, p in enumerate(full):
    lines.append(f'    {{"name": {d(p["name"])}, "capital": {d(p["capital"])}, "latitude": {p["latitude"]}, "longitude": {p["longitude"]}, "municipalities": [')
    for j, m in enumerate(p['municipios']):
        lat = 'null' if m['latitude'] is None else m['latitude']; lon = 'null' if m['longitude'] is None else m['longitude']
        head = f'      {{"name": {d(m["name"])}, "latitude": {lat}, "longitude": {lon}, "bairros": ['
        bairros = [f'        {{"name": {d(b["name"])}, "latitude": {b["latitude"]}, "longitude": {b["longitude"]}}}' for b in m['bairros']]
        end = '}' + (',' if j < len(p['municipios']) - 1 else '')
        lines.append(head + (']' + end if not bairros else ''))
        if bairros: lines += [',\n'.join(bairros), '      ]' + end]
    lines.append('    ]}' + (',' if i < len(full) - 1 else ''))
lines += ['  ]', '}']
open(sys.argv[1], 'w').write('\n'.join(lines) + '\n')
json.load(open(sys.argv[1]))
