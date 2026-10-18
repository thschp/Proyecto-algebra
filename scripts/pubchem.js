const PUBCHEM_REST = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const WIKIDATA_PUBCHEM_CID = 'P662';   
const REQUEST_TIMEOUT_MS = 15000;
const MAX_MATRIX_ATOMS = 80;           


async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('El servidor tardó demasiado en responder. Inténtalo de nuevo.');
    }
    throw new Error('No se pudo conectar. Revisa tu conexión a internet.');
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPubChemProperties(identifier) {
  const response = await fetchWithTimeout(
    `${PUBCHEM_REST}/compound/${identifier}/property/ConnectivitySMILES,Title/JSON`
  );

  if (response.status === 404 || response.status === 400) return null;

  if (response.status === 429 || response.status === 503) {
    throw new Error('PubChem está saturado en este momento. Espera unos segundos e inténtalo de nuevo.');
  }
  if (!response.ok) {
    throw new Error(`PubChem respondió con un error (${response.status}).`);
  }

  const data = await response.json();
  const compound = data?.PropertyTable?.Properties?.[0];  
  const smiles = compound?.ConnectivitySMILES ?? compound?.CanonicalSMILES ?? compound?.SMILES;

  if (!smiles) return null;
  return { cid: compound.CID, title: compound.Title, smiles };
}

const SMILES_ELEMENTS = new Map([
  ['B', 'B'], ['C', 'C'], ['N', 'N'], ['O', 'O'], ['P', 'P'], ['S', 'S'],
  ['F', 'F'], ['CL', 'Cl'], ['BR', 'Br'], ['I', 'I'], ['H', '[H]']
]);

function smilesBond(order) {
  return ({ 1: '', 2: '=', 3: '#' })[order] ?? null;
}

function smilesAtom(label) {
  const token = SMILES_ELEMENTS.get(String(label).trim().toUpperCase());
  if (!token) {
    throw new Error(`El átomo «${label}» no puede convertirse a SMILES. Usa símbolos químicos válidos.`);
  }
  return token;
}

// Construye un SMILES no canónico a partir de la matriz. PubChem lo normaliza
// al buscar la estructura, por lo que el orden de entrada de los átomos no afecta
// al resultado de identificación.
function matrixToSmiles(matrix, labels) {
  const atomCount = matrix.length;
  if (labels.length !== atomCount) throw new Error('La matriz y las etiquetas deben tener el mismo número de átomos.');

  const adjacent = matrix.map((row, atom) => row
    .map((order, neighbor) => order > 0 && neighbor !== atom ? { neighbor, order } : null)
    .filter(Boolean));
  const parents = Array(atomCount).fill(-1);
  const children = Array.from({ length: atomCount }, () => []);
  const discovered = Array(atomCount).fill(-1);
  const roots = [];
  let discoveryIndex = 0;

  function buildTree(atom, parent) {
    parents[atom] = parent;
    discovered[atom] = discoveryIndex++;
    for (const edge of adjacent[atom]) {
      if (edge.neighbor === parent || discovered[edge.neighbor] >= 0) continue;
      children[atom].push(edge);
      buildTree(edge.neighbor, atom);
    }
  }

  for (let atom = 0; atom < atomCount; atom++) {
    if (discovered[atom] < 0) {
      roots.push(atom);
      buildTree(atom, -1);
    }
  }

  const ringMarkers = Array.from({ length: atomCount }, () => []);
  const seenEdges = new Set();
  let ringNumber = 1;
  for (let atom = 0; atom < atomCount; atom++) {
    for (const edge of adjacent[atom]) {
      const key = atom < edge.neighbor ? `${atom}-${edge.neighbor}` : `${edge.neighbor}-${atom}`;
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      if (parents[atom] === edge.neighbor || parents[edge.neighbor] === atom) continue;
      const first = discovered[atom] < discovered[edge.neighbor] ? atom : edge.neighbor;
      const last = first === atom ? edge.neighbor : atom;
      const marker = ringNumber < 10 ? String(ringNumber) : `%${ringNumber}`;
      const bond = smilesBond(edge.order);
      if (bond === null) throw new Error('La matriz contiene un orden de enlace no compatible con SMILES.');
      ringMarkers[first].push(`${bond}${marker}`);
      ringMarkers[last].push(marker);
      ringNumber++;
    }
  }

  function encode(atom) {
    let output = smilesAtom(labels[atom]) + ringMarkers[atom].join('');
    const nextAtoms = [...children[atom]].sort((a, b) => {
      const aHydrogen = labels[a.neighbor].toUpperCase() === 'H';
      const bHydrogen = labels[b.neighbor].toUpperCase() === 'H';
      return Number(aHydrogen) - Number(bHydrogen);
    });
    const main = nextAtoms.shift();
    for (const branch of nextAtoms) {
      const bond = smilesBond(branch.order);
      if (bond === null) throw new Error('La matriz contiene un orden de enlace no compatible con SMILES.');
      output += `(${bond}${encode(branch.neighbor)})`;
    }
    if (main) {
      const bond = smilesBond(main.order);
      if (bond === null) throw new Error('La matriz contiene un orden de enlace no compatible con SMILES.');
      output += `${bond}${encode(main.neighbor)}`;
    }
    return output;
  }

  return roots.map(encode).join('.');
}

async function fetchPubChemNameFromSmiles(smiles) {
  const response = await fetchWithTimeout(
    `${PUBCHEM_REST}/compound/smiles/property/Title,IUPACName/JSON`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams({ smiles })
    }
  );

  if (response.status === 404 || response.status === 400) {
    throw new Error('PubChem no reconoció esta estructura molecular.');
  }
  if (!response.ok) throw new Error(`PubChem respondió con un error (${response.status}).`);

  const compound = (await response.json())?.PropertyTable?.Properties?.[0];
  if (!compound?.CID) throw new Error('PubChem no devolvió un compuesto para esta estructura.');
  return { cid: Number(compound.CID), title: compound.Title, iupacName: compound.IUPACName };
}

async function wikidataRequest(params) {
  const query = new URLSearchParams({ format: 'json', origin: '*', ...params });
  const response = await fetchWithTimeout(`${WIKIDATA_API}?${query}`);

  if (!response.ok) throw new Error(`Wikidata respondió con un error (${response.status}).`);
  return response.json();
}

async function findSpanishNameInWikidata(cid, names) {
  for (const name of names.filter(Boolean)) {
    const search = await wikidataRequest({
      action: 'wbsearchentities',
      search: name,
      language: 'en',
      uselang: 'es',
      type: 'item',
      limit: '8'
    });
    const candidates = search?.search ?? [];

    for (const candidate of candidates) {
      const entityData = await wikidataRequest({
        action: 'wbgetentities',
        ids: candidate.id,
        props: 'labels|claims',
        languages: 'es'
      });
      const entity = entityData?.entities?.[candidate.id];
      const candidateCid = entity?.claims?.[WIKIDATA_PUBCHEM_CID]?.[0]?.mainsnak?.datavalue?.value;
      const spanishLabel = entity?.labels?.es?.value;
      if (Number(candidateCid) === cid && spanishLabel) return spanishLabel;
    }
  }
  return null;
}

// Expone el flujo para los dos paneles del analizador: matriz → SMILES →
// PubChem → etiqueta española de Wikidata.
window.autonameMolecule = async function autonameMolecule(matrix, labels) {
  const smiles = matrixToSmiles(matrix, labels);
  const pubchem = await fetchPubChemNameFromSmiles(smiles);
  let spanishName = null;

  try {
    spanishName = await findSpanishNameInWikidata(pubchem.cid, [pubchem.title, pubchem.iupacName]);
  } catch (error) {
    console.warn('No se pudo obtener la etiqueta en español de Wikidata.', error);
  }

  return {
    name: spanishName || pubchem.title || pubchem.iupacName || 'Estructura molecular',
    smiles,
    cid: pubchem.cid,
    translated: Boolean(spanishName)
  };
};

async function findCidInWikidata(name) {
  const found = await wikidataRequest({
    action: 'wbsearchentities', search: name, language: 'es', uselang: 'es', type: 'item', limit: '5'
  });

  const candidates = found?.search ?? [];

  const matches = await Promise.all(candidates.map(async (item) => {
    const data = await wikidataRequest({
      action: 'wbgetclaims', entity: item.id, property: WIKIDATA_PUBCHEM_CID
    });
    const cid = data?.claims?.[WIKIDATA_PUBCHEM_CID]?.[0]?.mainsnak?.datavalue?.value;
    return cid ? { cid: Number(cid), label: item.label } : null;
  }));

  return matches.find(Boolean) ?? null;
}

async function fetchMolecule(name) {
  const direct = await fetchPubChemProperties(`name/${encodeURIComponent(name)}`);
  if (direct) return { ...direct, label: name, viaWikidata: false };

  const wikidata = await findCidInWikidata(name);
  if (wikidata) {
    const compound = await fetchPubChemProperties(`cid/${wikidata.cid}`);
    if (compound) return { ...compound, label: wikidata.label || name, viaWikidata: true };
  }

  throw new Error(
    `No se encontró ninguna molécula llamada «${name}». Revisa la ortografía o prueba con el nombre en inglés.`
  );
}

const BOND_SYMBOLS = { '-': 1, '=': 2, '#': 3, '$': 4, ':': 'ar', '/': 1, '\\': 1 };

const IMPLICIT_VALENCES = {
  B: [3], C: [4], N: [3, 5], O: [2], P: [3, 5], S: [2, 4, 6],
  F: [1], Cl: [1], Br: [1], I: [1]
};

function parseBracketAtom(content) {
  const match = content.match(
    /^(\d+)?([A-Z][a-z]?|[a-z][a-z]?)(@{1,2})?(?:H(\d*))?([+-]+|[+-]\d+)?(?::\d+)?$/
  );

  if (!match) {
    throw new Error(`SMILES no soportado: átomo «[${content}]».`);
  }

  const [, , rawSymbol, , rawH, rawCharge] = match;

  let charge = 0;
  if (rawCharge) {
    const sign = rawCharge[0] === '+' ? 1 : -1;
    charge = /^[+-]\d+$/.test(rawCharge) ? sign * Number(rawCharge.slice(1)) : sign * rawCharge.length;
  }

  return {
    symbol: rawSymbol[0].toUpperCase() + rawSymbol.slice(1),
    aromatic: /^[a-z]/.test(rawSymbol),
    charge,
    hExplicit: rawH === undefined ? 0 : rawH === '' ? 1 : Number(rawH)
  };
}

function parseSmiles(smiles) {
  const atoms = [];      
  const bonds = [];       
  const branchStack = [];
  const openRings = new Map();
  let previous = null;
  let pendingBond = null;
  let i = 0;

  const addAtom = (atom) => {
    const index = atoms.length;
    atoms.push(atom);

    if (previous !== null) {
      const implicit = atom.aromatic && atoms[previous].aromatic ? 'ar' : 1;
      bonds.push({ a: previous, b: index, order: pendingBond ?? implicit });
    }

    pendingBond = null;
    previous = index;
  };

  const ringDigit = (number) => {
    if (previous === null) {
      throw new Error('SMILES inválido: cierre de anillo sin átomo previo.');
    }

    const open = openRings.get(number);

    if (open) {
      const implicit = atoms[open.atom].aromatic && atoms[previous].aromatic ? 'ar' : 1;
      bonds.push({ a: open.atom, b: previous, order: pendingBond ?? open.bond ?? implicit });
      openRings.delete(number);
    } else {
      openRings.set(number, { atom: previous, bond: pendingBond });
    }

    pendingBond = null;
  };

  while (i < smiles.length) {
    const char = smiles[i];

    if (char === '(') {
      if (previous === null) throw new Error('SMILES inválido: rama sin átomo previo.');
      branchStack.push(previous);
      i++;
    } else if (char === ')') {
      if (!branchStack.length) throw new Error('SMILES inválido: paréntesis de cierre sin apertura.');
      previous = branchStack.pop();
      pendingBond = null;
      i++;
    } else if (char === '.') {
      previous = null;
      pendingBond = null;
      i++;
    } else if (BOND_SYMBOLS[char] !== undefined) {
      pendingBond = BOND_SYMBOLS[char];
      i++;
    } else if (char === '[') {
      const end = smiles.indexOf(']', i);
      if (end < 0) throw new Error('SMILES inválido: corchete sin cerrar.');
      addAtom(parseBracketAtom(smiles.slice(i + 1, end)));
      i = end + 1;
    } else if (/\d/.test(char)) {
      ringDigit(Number(char));
      i++;
    } else if (char === '%') {
      const digits = smiles.slice(i + 1, i + 3);
      if (!/^\d\d$/.test(digits)) throw new Error('SMILES inválido: número de anillo «%» incorrecto.');
      ringDigit(Number(digits));
      i += 3;
    } else {
      const two = smiles.slice(i, i + 2);

      if (two === 'Cl' || two === 'Br') {
        addAtom({ symbol: two, aromatic: false, charge: 0, hExplicit: null });
        i += 2;
      } else if ('BCNOPSFI'.includes(char)) {
        addAtom({ symbol: char, aromatic: false, charge: 0, hExplicit: null });
        i++;
      } else if ('bcnops'.includes(char)) {
        addAtom({ symbol: char.toUpperCase(), aromatic: true, charge: 0, hExplicit: null });
        i++;
      } else {
        throw new Error(`SMILES no soportado: carácter «${char}».`);
      }
    }
  }

  if (branchStack.length) throw new Error('SMILES inválido: paréntesis sin cerrar.');
  if (openRings.size) throw new Error('SMILES inválido: anillo sin cerrar.');
  if (!atoms.length) throw new Error('El SMILES no contiene átomos.');

  return { atoms, bonds };
}

function demoteNonRingAromaticBonds(atomCount, bonds) {
  const adjacent = Array.from({ length: atomCount }, () => []);
  bonds.forEach((bond) => { adjacent[bond.a].push(bond); adjacent[bond.b].push(bond); });

  bonds.filter((bond) => bond.order === 'ar').forEach((target) => {
    const seen = new Set([target.a]);
    const queue = [target.a];

    while (queue.length) {
      const current = queue.shift();
      for (const bond of adjacent[current]) {
        if (bond === target) continue;
        const next = bond.a === current ? bond.b : bond.a;
        if (!seen.has(next)) { seen.add(next); queue.push(next); }
      }
    }

    if (!seen.has(target.b)) target.order = 1;
  });
}

function effectiveValence({ symbol, charge }) {
  const base = { B: 3, C: 4, N: 3, O: 2, P: 3, S: 2, Se: 2, As: 3 }[symbol];
  if (base === undefined) return null;
  if (symbol === 'C') return base - Math.abs(charge);
  if (symbol === 'B') return base - charge;
  return base + charge;
}

function kekulize(atoms, bonds) {
  const aromaticBonds = bonds.filter((bond) => bond.order === 'ar');
  if (!aromaticBonds.length) return;

  const valenceSum = atoms.map(() => 0);
  bonds.forEach(({ a, b, order }) => {
    const value = order === 'ar' ? 1 : order;
    valenceSum[a] += value;
    valenceSum[b] += value;
  });

  const links = atoms.map(() => []);
  aromaticBonds.forEach((bond) => { links[bond.a].push(bond); links[bond.b].push(bond); });

  const needsDouble = atoms.map((atom, i) => {
    if (!links[i].length) return false;
    const valence = effectiveValence(atom);
    return valence !== null && valence - valenceSum[i] - (atom.hExplicit ?? 0) >= 1;
  });

  const chosen = new Map();
  const otherEnd = (bond, atom) => (bond.a === atom ? bond.b : bond.a);

  function solve() {
    let best = -1;
    let bestOptions = null;

    for (let i = 0; i < atoms.length; i++) {
      if (!needsDouble[i] || chosen.has(i)) continue;

      const options = links[i].filter((bond) => {
        const other = otherEnd(bond, i);
        return needsDouble[other] && !chosen.has(other);
      });

      if (!options.length) return false;
      if (best < 0 || options.length < bestOptions.length) { best = i; bestOptions = options; }
    }

    if (best < 0) return true;

    for (const bond of bestOptions) {
      const other = otherEnd(bond, best);
      chosen.set(best, bond);
      chosen.set(other, bond);
      if (solve()) return true;
      chosen.delete(best);
      chosen.delete(other);
    }

    return false;
  }

  if (!solve()) {
    throw new Error('No se pudo interpretar el sistema aromático del SMILES.');
  }

  aromaticBonds.forEach((bond) => { bond.order = chosen.get(bond.a) === bond ? 2 : 1; });
}


function countHydrogens(atom, valenceSum) {
  if (atom.hExplicit !== null) return atom.hExplicit;     
  const target = IMPLICIT_VALENCES[atom.symbol].find((valence) => valence >= valenceSum);
  return target === undefined ? 0 : target - valenceSum;
}

function smilesToMatrix(smiles, { includeHydrogens = true } = {}) {
  const { atoms, bonds } = parseSmiles(smiles.trim());

  demoteNonRingAromaticBonds(atoms.length, bonds);
  kekulize(atoms, bonds);

  if (bonds.some((bond) => bond.order > 3)) {
    throw new Error('La matriz solo admite enlaces simples, dobles y triples.');
  }

  const valenceSum = atoms.map(() => 0);
  bonds.forEach(({ a, b, order }) => { valenceSum[a] += order; valenceSum[b] += order; });

  let kept = atoms.map((_, i) => i);
  if (!includeHydrogens) {
    const heavy = kept.filter((i) => atoms[i].symbol !== 'H');
    if (heavy.length) kept = heavy;
  }

  const hydrogenParents = includeHydrogens
    ? kept.flatMap((i) => Array(countHydrogens(atoms[i], valenceSum[i])).fill(i))
    : [];

  const total = kept.length + hydrogenParents.length;

  if (total > MAX_MATRIX_ATOMS) {
    throw new Error(
      `La molécula tiene ${total} átomos y el máximo es ${MAX_MATRIX_ATOMS}.` +
      (includeHydrogens ? ' Prueba a desmarcar «Incluir hidrógenos».' : '')
    );
  }

  const position = new Map(kept.map((atomIndex, k) => [atomIndex, k]));
  const labels = kept.map((i) => atoms[i].symbol);
  const matrix = Array.from({ length: total }, () => Array(total).fill(0));

  bonds.forEach(({ a, b, order }) => {
    if (position.has(a) && position.has(b)) {
      matrix[position.get(a)][position.get(b)] = order;
      matrix[position.get(b)][position.get(a)] = order;
    }
  });

  hydrogenParents.forEach((parent, k) => {
    const hydrogen = kept.length + k;
    const parentPosition = position.get(parent);
    labels.push('H');
    matrix[parentPosition][hydrogen] = 1;
    matrix[hydrogen][parentPosition] = 1;
  });

  return { matrix, labels };
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

function setupPubChemPanel() {
  const input = document.getElementById('pubchem-name');
  const hydrogens = document.getElementById('pubchem-hydrogens');
  const button = document.getElementById('analyze-pubchem');
  const error = document.getElementById('pubchem-error');
  const info = document.getElementById('pubchem-info');

  if (!input || !button) return;

  async function searchAndAnalyze() {
    const name = input.value.trim();
    error.textContent = '';
    info.classList.add('hidden');

    if (!name) {
      error.textContent = 'Escribe el nombre de una molécula.';
      return;
    }

    const originalLabel = button.innerHTML;
    button.disabled = true;
    button.textContent = 'Buscando molécula…';

    try {
      const molecule = await fetchMolecule(name);
      const { matrix, labels } = smilesToMatrix(molecule.smiles, { includeHydrogens: hydrogens.checked });

      analyze(matrix, labels, capitalize(molecule.label));

      info.innerHTML =
        `<strong>${escapeHtml(molecule.title || molecule.label)}</strong> en PubChem · CID ${Number(molecule.cid)}` +
        (molecule.viaWikidata ? ' · encontrada con Wikidata' : '') + '<br>' +
        `<a href="https://pubchem.ncbi.nlm.nih.gov/compound/${Number(molecule.cid)}" target="_blank" rel="noopener">Ver en PubChem ↗</a>`;
      info.classList.remove('hidden');
    } catch (searchError) {
      error.textContent = searchError.message;
      console.error(searchError);
    } finally {
      button.disabled = false;
      button.innerHTML = originalLabel;
    }
  }

  button.addEventListener('click', searchAndAnalyze);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') searchAndAnalyze();
  });
}

setupPubChemPanel();
