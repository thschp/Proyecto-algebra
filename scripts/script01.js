
const state = {
  atoms: ['C', 'C', 'O', 'H'],
  bonds: [[0, 1, 1], [1, 2, 1], [2, 3, 1]]
};

const $ = (selector) => document.querySelector(selector);

const atomSymbols = () =>
  [...document.querySelectorAll('.atom-input')].map((input) => input.value.trim().toUpperCase());


function renderAtoms() {
  $('#atom-list').innerHTML = state.atoms
    .map((atom, index) =>
      `<div class="atom-row"><input class="atom-input" maxlength="2" value="${atom}" aria-label="Átomo ${index + 1}"><button class="remove-button" data-remove-atom="${index}" aria-label="Eliminar átomo ${index + 1}">×</button></div>`
    )
    .join('');

  renderBonds();
}

function renderBonds() {
  const symbols = atomSymbols();

  if (symbols.length < 2) {
    $('#bond-list').innerHTML = '<p>Agrega al menos dos átomos para crear una conexión.</p>';
    return;
  }

  $('#bond-list').innerHTML = state.bonds
    .map((bond, index) =>
      `<div class="bond-row">` +
        `<select class="select-input bond-a" data-index="${index}">${symbols.map((s, i) => `<option value="${i}" ${i === bond[0] ? 'selected' : ''}>${i + 1} · ${s || '?'}</option>`).join('')}</select>` +
        `<span>↔</span>` +
        `<select class="select-input bond-b" data-index="${index}">${symbols.map((s, i) => `<option value="${i}" ${i === bond[1] ? 'selected' : ''}>${i + 1} · ${s || '?'}</option>`).join('')}</select>` +
        `<select class="select-input bond-type" data-index="${index}">` +
          `<option value="1" ${bond[2] === 1 ? 'selected' : ''}>Sencillo · 1</option>` +
          `<option value="2" ${bond[2] === 2 ? 'selected' : ''}>Doble · 2</option>` +
          `<option value="3" ${bond[2] === 3 ? 'selected' : ''}>Triple · 3</option>` +
        `</select>` +
        `<button class="remove-button" data-remove-bond="${index}" aria-label="Eliminar conexión">×</button>` +
      `</div>`
    )
    .join('');
}


function matrixFromBonds(symbols, bonds) {
  const matrix = symbols.map(() => symbols.map(() => 0));

  bonds.forEach(([a, b, value]) => {
    if (a !== b && matrix[a] && matrix[b]) {
      matrix[a][b] = matrix[b][a] = Number(value);
    }
  });

  return matrix;
}

function parseMatrix(text) {
  const rows = text
    .trim()
    .split(/\n+/)
    .map((row) => row.trim().split(/[\s,;]+/).filter(Boolean).map(Number));

  if (!text.trim() || rows.some((row) => row.length === 0) || rows.some((row) => row.length !== rows.length)) {
    throw new Error('La matriz debe ser cuadrada y no puede estar vacía.');
  }

  if (rows.some((row) => row.some((value) => !Number.isInteger(value) || value < 0 || value > 3))) {
    throw new Error('Solo se permiten valores enteros entre 0 y 3.');
  }

  if (rows.some((row, i) => row[i] !== 0)) {
    throw new Error('La diagonal principal debe contener únicamente ceros.');
  }

  if (rows.some((row, i) => row.some((value, j) => value !== rows[j][i]))) {
    throw new Error('La matriz debe ser simétrica: Aᵢⱼ = Aⱼᵢ.');
  }

  return rows;
}


function analyze(matrix, atoms, name) {
  const n = matrix.length;
  const degrees = matrix.map((row) => row.reduce((sum, value) => sum + value, 0));
  let connections = 0;
  let order = 0;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (matrix[i][j] > 0) {
        connections++;
        order += matrix[i][j];
      }
    }
  }

  const visited = new Set();
  const components = [];

  for (let start = 0; start < n; start++) {
    if (!visited.has(start)) {
      const group = [];
      const queue = [start];
      visited.add(start);

      while (queue.length) {
        const current = queue.shift();
        group.push(current);

        matrix[current].forEach((value, next) => {
          if (value > 0 && !visited.has(next)) {
            visited.add(next);
            queue.push(next);
          }
        });
      }

      components.push(group);
    }
  }

  renderResults({
    matrix,
    atoms,
    name: name || 'Estructura molecular',
    degrees,
    connections,
    order,
    components
  });
}


function renderResults(data) {
  $('#results').classList.remove('hidden');
  $('#result-title').textContent = `${data.name}, en datos.`;
  $('#matrix-result-name').textContent = data.name;
  $('#metric-atoms').textContent = data.matrix.length;
  $('#metric-connections').textContent = data.connections;
  $('#metric-order').textContent = data.order;
  $('#metric-components').textContent = data.components.length;
  $('#connectivity-label').textContent = data.components.length === 1 ? 'estructura conectada' : 'grupos separados';

  $('#matrix-output').innerHTML =
    `<table class="matrix-table">` +
      `<thead><tr><th></th>${data.atoms.map((a, i) => `<th>${a || `A${i + 1}`}</th>`).join('')}</tr></thead>` +
      `<tbody>${data.matrix.map((row, i) => `<tr><th>${data.atoms[i] || `A${i + 1}`}</th>${row.map((value) => `<td>${value}</td>`).join('')}</tr>`).join('')}</tbody>` +
      `</table>`;

  const copyButton = $('#copy-matrix');
  copyButton.onclick = async () => {
    const matrixText = data.matrix.map((row) => row.join(' ')).join('\n');

    try {
      await navigator.clipboard.writeText(matrixText);
      copyButton.textContent = '¡Matriz copiada!';
      setTimeout(() => { copyButton.textContent = 'Copiar matriz'; }, 1800);
    } catch (error) {
      const temporaryInput = document.createElement('textarea');
      temporaryInput.value = matrixText;
      temporaryInput.style.position = 'fixed';
      temporaryInput.style.opacity = '0';
      document.body.appendChild(temporaryInput);
      temporaryInput.select();
      const copied = document.execCommand('copy');
      temporaryInput.remove();
      copyButton.textContent = copied ? '¡Matriz copiada!' : 'No se pudo copiar';
      setTimeout(() => { copyButton.textContent = 'Copiar matriz'; }, 1800);
    }
  };

  $('#degree-output').innerHTML = data.degrees
    .map((degree, i) => `<span class="degree-chip"><strong>${i + 1} · ${data.atoms[i] || `A${i + 1}`}</strong> grado ${degree}</span>`)
    .join('');

  $('#connectivity-output').innerHTML = data.components
    .map((group, i) =>
      `<div class="component-item"><strong>Componente ${i + 1}</strong>${group.map((index) => `${index + 1} · ${data.atoms[index] || `A${index + 1}`}`).join('  —  ')}</div>`
    )
    .join('');

  renderGraph(data);
  $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}


function inferAtomLabels(matrix) {
  const valence = { 1: 'H', 2: 'O', 3: 'N', 4: 'C' };

  return matrix.map((row, i) => {
    const bondCount = row.reduce((a, b) => a + b, 0);
    return valence[bondCount] || `A${i + 1}`;
  });
}

function readMatrixLabels(text, size) {
  if (!text.trim()) return null;
  const labels = text.trim().split(/[\s,;]+/).filter(Boolean).map((label) => label.toUpperCase());
  if (labels.length !== size) {
    throw new Error(`Se esperaban ${size} etiquetas, pero se encontraron ${labels.length}.`);
  }
  if (labels.some((label) => !/^[A-Z][A-Z]?$/.test(label))) {
    throw new Error('Cada etiqueta debe ser un símbolo químico, como C, O, N o Cl.');
  }
  return labels;
}

function renderLinearGraph(data) {
  const n = data.atoms.length;
  
  const heavyAtoms = data.atoms
    .map((atom, i) => (atom !== 'H' ? i : -1))
    .filter((i) => i >= 0);
    
  const order = heavyAtoms.length ? heavyAtoms : [...Array(n).keys()];
  const positions = Array(n).fill(null);

  order.forEach((index, position) => { 
    positions[index] = [position, 0]; 
  });

  data.atoms.forEach((atom, i) => {
    if (atom !== 'H' || positions[i]) return;

    const parentIndex = data.matrix[i].findIndex((bond) => bond > 0);
    
    if (parentIndex < 0) { 
      positions[i] = [i, 1]; 
      return; 
    }

    const candidates = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    const parentPos = positions[parentIndex] || [i, 0];
    
    const candidate = candidates.find(([dx, dy]) => {
      const targetX = parentPos[0] + dx;
      const targetY = parentPos[1] + dy;
      return !positions.some((point) => point && point[0] === targetX && point[1] === targetY);
    }) || [0, -1];

    positions[i] = [parentPos[0] + candidate[0], parentPos[1] + candidate[1]];
  });

  positions.forEach((point, i) => { 
    if (!point) positions[i] = [i, 0]; 
  });

  const unit = 78; 
  const pad = 38; 
  const xs = positions.map(([x]) => x);
  const ys = positions.map(([, y]) => y);
  
  const minX = Math.min(...xs); 
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  
  const width = Math.max(280, (maxX - minX + 1) * unit + pad * 2); 
  const height = Math.max(170, (maxY - minY + 1) * unit + pad * 2);
  
  const getPoint = (i) => [
    (positions[i][0] - minX) * unit + pad, 
    (positions[i][1] - minY) * unit + pad
  ];

  let svg = `<svg class="graph-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Fórmula estructural">\n`;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const multiplicity = data.matrix[i][j]; 
      if (!multiplicity) continue;

      const [x1, y1] = getPoint(i); 
      const [x2, y2] = getPoint(j); 
      
      const dx = x2 - x1; 
      const dy = y2 - y1; 
      const length = Math.hypot(dx, dy); 
      
      const ux = dx / length; 
      const uy = dy / length; 
      const nx = -uy; 
      const ny = ux;

      for (let k = 0; k < multiplicity; k++) { 
        const gap = (k - (multiplicity - 1) / 2) * 7; 
        const lineX1 = x1 + ux * 18 + nx * gap;
        const lineY1 = y1 + uy * 18 + ny * gap;
        const lineX2 = x2 - ux * 18 + nx * gap;
        const lineY2 = y2 - uy * 18 + ny * gap;
        
        svg += `  <line x1="${lineX1}" y1="${lineY1}" x2="${lineX2}" y2="${lineY2}" stroke="#456d70" stroke-width="2"/>\n`; 
      }
    }
  }

  data.atoms.forEach((atom, i) => { 
    const [x, y] = getPoint(i); 
    const label = atom || `A${i + 1}`;
    svg += `  <text class="structure-atom" x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central">${label}</text>\n`; 
  });

  svg += '</svg>';
  $('#graph-output').innerHTML = svg;
}

function buscarAnillos(matrix, atoms) {
  const skeletonAtoms = atoms
    .map((atom, index) => (atom !== 'H' ? index : -1))
    .filter((index) => index >= 0);
    
  const skeleton = new Set(skeletonAtoms);
  const visited = new Set();

  function dfs(current, parent, path) {
    visited.add(current);
    
    for (let next = 0; next < matrix.length; next++) {
      const isSkeleton = skeleton.has(next);
      const isBonded = matrix[current][next] > 0;
      const isParent = next === parent;
      
      if (!isSkeleton || !isBonded || isParent) continue;
      
      if (path.includes(next)) {
        return path.slice(path.indexOf(next));
      }
      
      if (!visited.has(next)) {
        const cycle = dfs(next, current, [...path, next]);
        if (cycle) return cycle;
      }
    }
    return null;
  }

  for (const start of skeleton) {
    if (!visited.has(start)) {
      const cycle = dfs(start, -1, [start]);
      if (cycle && cycle.length >= 3) return cycle;
    }
  }
  
  return null;
}

function colocarAnillo(matrix, atoms, ring) {
  const positions = Array(matrix.length).fill(null);
  const radius = Math.max(1.45, 0.55 * ring.length);
  
  ring.forEach((atom, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / ring.length;
    positions[atom] = [radius * Math.cos(angle), radius * Math.sin(angle)];
  });

  ring.forEach((atom) => {
    const substituents = matrix[atom]
      .map((bond, index) => (bond > 0 && !ring.includes(index) ? index : -1))
      .filter((index) => index >= 0);
      
    const [x, y] = positions[atom];
    const length = Math.hypot(x, y) || 1;
    const outward = [x / length, y / length];
    const angles = substituents.length > 1 ? [-Math.PI / 3, Math.PI / 3] : [0];
    
    substituents.forEach((substituent, index) => {
      const angle = Math.atan2(outward[1], outward[0]) + (angles[index] || 0);
      positions[substituent] = [
        x + Math.cos(angle) * 1.25, 
        y + Math.sin(angle) * 1.25
      ];
    });
  });

  positions.forEach((position, index) => {
    if (!position) positions[index] = [index * 1.5, 0];
  });
  
  return positions;
}

function renderGraph(data) {
  const ring = buscarAnillos(data.matrix, data.atoms);
  
  if (!ring) {
    renderLinearGraph(data);
    return;
  }

  const positions = colocarAnillo(data.matrix, data.atoms, ring);
  const unit = 72;
  const padding = 48;
  
  const xs = positions.map(([x]) => x);
  const ys = positions.map(([, y]) => y);
  
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  
  const width = Math.max(280, (maxX - minX) * unit + padding * 2);
  const height = Math.max(210, (maxY - minY) * unit + padding * 2);
  
  const getPoint = (index) => [
    (positions[index][0] - minX) * unit + padding, 
    (positions[index][1] - minY) * unit + padding
  ];

  let svg = `<svg class="graph-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Anillo molecular">\n`;

  for (let i = 0; i < data.matrix.length; i++) {
    for (let j = i + 1; j < data.matrix.length; j++) {
      const multiplicity = data.matrix[i][j];
      if (!multiplicity) continue;
      
      const [x1, y1] = getPoint(i);
      const [x2, y2] = getPoint(j);
      
      const dx = x2 - x1;
      const dy = y2 - y1;
      const length = Math.hypot(dx, dy);
      
      const ux = dx / length;
      const uy = dy / length;
      const nx = -uy;
      const ny = ux;
      
      for (let line = 0; line < multiplicity; line++) {
        const gap = (line - (multiplicity - 1) / 2) * 7;
        const lineX1 = x1 + ux * 17 + nx * gap;
        const lineY1 = y1 + uy * 17 + ny * gap;
        const lineX2 = x2 - ux * 17 + nx * gap;
        const lineY2 = y2 - uy * 17 + ny * gap;
        
        svg += `  <line x1="${lineX1}" y1="${lineY1}" x2="${lineX2}" y2="${lineY2}" stroke="#456d70" stroke-width="2"/>\n`;
      }
    }
  }

  data.atoms.forEach((atom, index) => {
    const [x, y] = getPoint(index);
    const label = atom || `A${index + 1}`;
    svg += `  <text class="structure-atom" x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central">${label}</text>\n`;
  });
  
  svg += '</svg>';
  $('#graph-output').innerHTML = svg;
}

function distribuirEstructura(matrix, atoms) {
  const n = matrix.length;
  const positions = Array(n).fill(null);
  const used = new Set();
  const heavy = new Set(atoms.map((atom, i) => atom !== 'H' ? i : -1).filter((i) => i >= 0));
  const key = (x, y) => `${x.toFixed(3)},${y.toFixed(3)}`;
  const neighbors = (i, onlyHeavy = false) => matrix[i].map((bond, j) => bond > 0 && j !== i && (!onlyHeavy || heavy.has(j)) ? j : -1).filter((j) => j >= 0);
  let componentOffset = 0;

  function findCycle(component) {
    const visited = new Set();
    function dfs(current, parent, path) {
      visited.add(current);
      for (const next of neighbors(current, true)) {
        if (!component.has(next) || next === parent) continue;
        if (path.includes(next)) return path.slice(path.indexOf(next));
        if (!visited.has(next)) {
          const cycle = dfs(next, current, [...path, next]);
          if (cycle) return cycle;
        }
      }
      return null;
    }
    for (const start of component) {
      if (!visited.has(start)) {
        const cycle = dfs(start, -1, [start]);
        if (cycle && cycle.length >= 3) return cycle;
      }
    }
    return null;
  }

  function place(index, x, y) {
    positions[index] = [x, y];
    used.add(key(x, y));
  }

  const componentSeen = new Set();
  for (const start of heavy) {
    if (componentSeen.has(start)) continue;
    const component = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const current = queue.shift();
      componentSeen.add(current);
      neighbors(current, true).forEach((next) => {
        if (!component.has(next)) { component.add(next); queue.push(next); }
      });
    }

    const cycle = findCycle(component);
    const placedInComponent = new Set();
    if (cycle) {
      const radius = Math.max(1.8, cycle.length * 0.55);
      cycle.forEach((atom, index) => {
        const angle = -Math.PI / 2 + (index * Math.PI * 2) / cycle.length;
        place(atom, radius * Math.cos(angle), radius * Math.sin(angle));
        placedInComponent.add(atom);
      });
    } else {
      const root = [...component].find((atom) => neighbors(atom, true).filter((next) => component.has(next)).length <= 1) ?? start;
      place(root, 0, 0);
      placedInComponent.add(root);
    }

    const pending = [...component].filter((atom) => !placedInComponent.has(atom));
    while (pending.length) {
      let progress = false;
      for (let p = pending.length - 1; p >= 0; p--) {
        const atom = pending[p];
        const parent = neighbors(atom, true).find((next) => placedInComponent.has(next));
        if (parent === undefined) continue;
        const [px, py] = positions[parent];
        const awayX = px === 0 && py === 0 ? 1 : px;
        const awayY = py;
        const length = Math.hypot(awayX, awayY) || 1;
        const baseAngle = Math.atan2(awayY, awayX);
        const alternatives = [baseAngle, baseAngle + Math.PI / 2, baseAngle - Math.PI / 2, baseAngle + Math.PI];
        let candidate = null;
        for (const angle of alternatives) {
          const x = px + Math.cos(angle) * 1.65;
          const y = py + Math.sin(angle) * 1.65;
          if (![...placedInComponent].some((i) => Math.hypot(positions[i][0] - x, positions[i][1] - y) < 0.7)) { candidate = [x, y]; break; }
        }
        if (!candidate) candidate = [px + 1.65, py];
        place(atom, candidate[0], candidate[1]);
        placedInComponent.add(atom);
        pending.splice(p, 1);
        progress = true;
      }
      if (!progress) break;
    }

    for (const atom of component) {
      const hydrogens = neighbors(atom).filter((next) => atoms[next] === 'H' && !positions[next]);
      if (!positions[atom]) continue;
      const [x, y] = positions[atom];
      const heavyNeighbors = neighbors(atom, true).filter((next) => positions[next]);
      let outwardAngle = Math.atan2(y, x);

      if (heavyNeighbors.length === 1) {
        const [neighborX, neighborY] = positions[heavyNeighbors[0]];
        outwardAngle = Math.atan2(y - neighborY, x - neighborX);
      } else if (heavyNeighbors.length > 1) {
        const vector = heavyNeighbors.reduce((result, next) => [
          result[0] + (positions[next][0] - x),
          result[1] + (positions[next][1] - y)
        ], [0, 0]);
        outwardAngle = Math.atan2(-vector[1], -vector[0]);
        if (Math.hypot(vector[0], vector[1]) < 0.01) outwardAngle = Math.PI / 2;
      }

      hydrogens.forEach((hydrogen, index) => {
        const count = hydrogens.length;
        const spread = count === 1
          ? 0
          : count === 2
            ? (index === 0 ? -Math.PI / 3 : Math.PI / 3)
            : (index - (count - 1) / 2) * (Math.PI / 3);
        const angle = outwardAngle + spread;
        let distance = 1.35;
        let candidate = null;
        while (!candidate && distance <= 2.5) {
          const xCandidate = x + Math.cos(angle) * distance;
          const yCandidate = y + Math.sin(angle) * distance;
          const occupied = positions.some((position) => position && Math.hypot(position[0] - xCandidate, position[1] - yCandidate) < 0.75);
          if (!occupied) candidate = [xCandidate, yCandidate];
          distance += 0.2;
        }
        if (!candidate) candidate = [x + Math.cos(angle) * 1.35, y + Math.sin(angle) * 1.35];
        place(hydrogen, candidate[0], candidate[1]);
      });
    }

    const members = [...component].concat([...component].flatMap((atom) => neighbors(atom).filter((next) => atoms[next] === 'H')));
    const minX = Math.min(...members.map((i) => positions[i][0]));
    const maxX = Math.max(...members.map((i) => positions[i][0]));
    members.forEach((i) => { positions[i][0] += componentOffset - minX; });
    componentOffset += maxX - minX + 2.5;
  }

  positions.forEach((position, index) => {
    if (!position) { positions[index] = [componentOffset, 0]; componentOffset += 2.5; }
  });
  return positions;
}

function renderGraph(data) {
  const positions = distribuirEstructura(data.matrix, data.atoms);
  const unit = 78;
  const padding = 48;
  const xs = positions.map(([x]) => x);
  const ys = positions.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const viewWidth = Math.max(280, (maxX - minX) * unit + padding * 2);
  const viewHeight = Math.max(210, (maxY - minY) * unit + padding * 2);
  const point = (index) => [(positions[index][0] - minX) * unit + padding, (positions[index][1] - minY) * unit + padding];
  let svg = `<svg class="graph-svg" viewBox="0 0 ${viewWidth} ${viewHeight}" role="img" aria-label="Fórmula estructural">`;

  for (let i = 0; i < data.matrix.length; i++) for (let j = i + 1; j < data.matrix.length; j++) {
    const multiplicity = data.matrix[i][j];
    if (!multiplicity) continue;
    const [x1, y1] = point(i); const [x2, y2] = point(j);
    const dx = x2 - x1; const dy = y2 - y1; const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length; const uy = dy / length; const nx = -uy; const ny = ux;
    for (let line = 0; line < multiplicity; line++) {
      const gap = (line - (multiplicity - 1) / 2) * 7;
      svg += `<line x1="${x1 + ux * 18 + nx * gap}" y1="${y1 + uy * 18 + ny * gap}" x2="${x2 - ux * 18 + nx * gap}" y2="${y2 - uy * 18 + ny * gap}" stroke="#456d70" stroke-width="2"/>`;
    }
  }
  data.atoms.forEach((atom, index) => {
    const [x, y] = point(index);
    svg += `<text class="structure-atom" x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central">${atom || `A${index + 1}`}</text>`;
  });
  svg += '</svg>';
  $('#graph-output').innerHTML = svg;
  const graphCard = $('#graph-output').closest('.graph-result');
  graphCard.classList.toggle('graph-wide', viewWidth / viewHeight > 2.2);
}

document.addEventListener('click', (event) => {
  const target = event.target;

  if (target.matches('[data-scroll]')) {
    $(target.dataset.scroll).scrollIntoView({ behavior: 'smooth' });
  }

  if (target.matches('[data-load-example]')) {
    state.atoms = ['C', 'C', 'H', 'H','H', 'H'];
    state.bonds = [[0, 1, 2], [0, 2, 1], [0, 3, 1], [1, 4, 1], [1, 5, 1]];
    $('#molecule-name').value = 'Etileno';
    renderAtoms();
    $('#analizador').scrollIntoView({ behavior: 'smooth' });
    document.querySelector('[data-panel="builder"]').classList.remove('hidden');
    document.querySelector('[data-panel="matrix"]').classList.add('hidden');
    document.querySelector('[data-panel="pubchem"]').classList.add('hidden');
    document.querySelector('.mode-tab[data-mode="builder"]').classList.add('active');
    document.querySelector('.mode-tab[data-mode="matrix"]').classList.remove('active');
    document.querySelector('.mode-tab[data-mode="pubchem"]').classList.remove('active');
    $('#analizador').scrollIntoView({ behavior: 'smooth' });
  }

  if (target.id === 'add-atom') {
    state.atoms.push('');
    renderAtoms();
    document.querySelectorAll('.atom-input')[state.atoms.length - 1].focus();
  }

  if (target.id === 'add-bond') {
    state.bonds.push([0, Math.min(1, state.atoms.length - 1), 1]);
    renderBonds();
  }

  if (target.dataset.removeAtom !== undefined) {
    if (state.atoms.length <= 2) return;

    state.atoms.splice(Number(target.dataset.removeAtom), 1);

    state.bonds = state.bonds
      .filter(([a, b]) => a !== Number(target.dataset.removeAtom) && b !== Number(target.dataset.removeAtom))
      .map(([a, b, v]) => [
        a > Number(target.dataset.removeAtom) ? a - 1 : a,
        b > Number(target.dataset.removeAtom) ? b - 1 : b,
        v
      ]);

    renderAtoms();
  }

  if (target.dataset.removeBond !== undefined) {
    state.bonds.splice(Number(target.dataset.removeBond), 1);
    renderBonds();
  }

  if (target.matches('.mode-tab')) {
    document.querySelectorAll('.mode-tab').forEach((tab) => tab.classList.toggle('active', tab === target));
    document.querySelectorAll('[data-panel]').forEach((panel) => panel.classList.toggle('hidden', panel.dataset.panel !== target.dataset.mode));
  }

  if (target.id === 'edit-analysis') {
    $('#analizador').scrollIntoView({ behavior: 'smooth' });
  }
});

document.addEventListener('input', (event) => {
  if (event.target.matches('.atom-input')) {
    const index = [...document.querySelectorAll('.atom-input')].indexOf(event.target);

    state.atoms[index] = event.target.value.toUpperCase();
    renderBonds();
  }
});

document.addEventListener('change', (event) => {
  const i = Number(event.target.dataset.index);

  if (event.target.matches('.bond-a')) state.bonds[i][0] = Number(event.target.value);
  if (event.target.matches('.bond-b')) state.bonds[i][1] = Number(event.target.value);
  if (event.target.matches('.bond-type')) state.bonds[i][2] = Number(event.target.value);
});

$('#analyze-builder').addEventListener('click', () => {
  const atoms = atomSymbols();
  const error = $('#builder-error');

  error.textContent = '';

  if (atoms.some((atom) => !/^[A-Z][A-Z]?$/.test(atom))) {
    error.textContent = 'Cada átomo debe tener un símbolo químico válido, como C, O o Cl.';
    return;
  }

  if (state.bonds.some(([a, b]) => a === b)) {
    error.textContent = 'Un átomo no puede conectarse consigo mismo.';
    return;
  }

  try {
    analyze(matrixFromBonds(atoms, state.bonds), atoms, $('#molecule-name').value.trim());
  } catch (analysisError) {
    error.textContent = `No se pudo generar la representación: ${analysisError.message}`;
    console.error(analysisError);
  }
});

$('#analyze-matrix').addEventListener('click', () => {
  const error = $('#matrix-error');

  error.textContent = '';

  try {
    const matrix = parseMatrix($('#matrix-input').value);

    const labels = readMatrixLabels($('#matrix-labels').value, matrix.length) || inferAtomLabels(matrix);
    analyze(matrix, labels, $('#matrix-name').value.trim());
  } catch (e) {
    error.textContent = e.message;
  }
});

renderAtoms();
