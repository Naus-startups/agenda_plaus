import re, json
lines = open('lei.txt', encoding='utf-8').read().split('\n')
out = []; i = 0
while i < len(lines):
    m = re.search(r'QUADRO RESUMO DA PROV[IÍ]NCIA D[AOE] (.+)$', lines[i])
    if not m: i += 1; continue
    prov = m.group(1).strip(); i += 1
    munis, comunas, totals = [], [], None
    while i < len(lines) and 'MAPA DA' not in lines[i] and 'QUADRO RESUMO' not in lines[i]:
        l = lines[i]
        if 'DIÁRIO DA REPÚBLICA' in l or 'Províncias' in l: i += 1; continue
        for mm in re.finditer(r'\S+(?: \S+)*', l):
            t, col = mm.group(0), mm.start()
            if re.fullmatch(r'\d+', t):
                totals = (totals or []) + [int(t)]; continue
            if t.upper() == t and col < 14: continue  # province label
            if col < 40: munis.append((t, col))
            else: comunas.append(t)
        i += 1
    out.append({'prov': prov, 'munis': [t for t, _ in munis], 'comunas': comunas, 'totals': totals})
for p in out:
    ok = p['totals'] and p['totals'][0] == len(p['munis'])
    print(('OK ' if ok else 'XX ') + p['prov'], len(p['munis']), p['totals'], len(p['comunas']))
print(sum(len(p['munis']) for p in out))
json.dump(out, open('raw.json', 'w'), ensure_ascii=False, indent=1)
