(function () {
  "use strict";

  const TAG_DEFS = [
    { key: "tag_haut_potentiel", label: "Haut potentiel", color: "--status-warning", textColor: "#000" },
    { key: "tag_en_fragilite", label: "En fragilité", color: "--status-critical" },
    { key: "tag_consultant_isole", label: "Consultant isolé", color: "--slot-magenta" },
  ];

  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const isOui = (v) => String(v || "").trim().toLowerCase() === "oui";
  const norm = (v) => (v === undefined || v === null ? "" : String(v).trim());

  function roleOf(poste) {
    if (poste === "Senior Manager") return "SM";
    if (poste === "Manager") return "Manager";
    if (poste === "Chef de projet" || poste === "Directeur de projet") return "CP";
    return null;
  }
  function roleColorVar(role) {
    if (role === "SM") return "--node-person-sm";
    if (role === "Manager") return "--node-person-manager";
    if (role === "CP") return "--node-person-cp";
    return "--node-person";
  }

  let network = null;
  let allNodesDataset = null;
  let allEdgesDataset = null;
  let pinnedId = null;
  let hoveringNode = false;
  let teamMeetingCircles = []; // réunions non-individuelles : dessinées en cercle, pas en nœud
  let hoveredCircleId = null;
  let hautPotentielNodes = []; // {id, size} : pastille jaune toujours visible, en plus du survol
  let state = { collaborateurs: [], points: [] };
  let raw = { collab: null, rattach: null, points: null };

  const els = {
    fileCollab: document.getElementById("file-collab"),
    fileRattach: document.getElementById("file-rattach"),
    filePoints: document.getElementById("file-points"),
    dzCollab: document.getElementById("dz-collab"),
    dzRattach: document.getElementById("dz-rattach"),
    dzPoints: document.getElementById("dz-points"),
    loadedCollab: document.getElementById("loaded-collab"),
    loadedCollabName: document.getElementById("loaded-collab-name"),
    btnChangeCollab: document.getElementById("btn-change-collab"),
    rattachChoice: document.getElementById("rattach-choice"),
    loadedRattach: document.getElementById("loaded-rattach"),
    loadedRattachName: document.getElementById("loaded-rattach-name"),
    btnChangeRattach: document.getElementById("btn-change-rattach"),
    btnSkipRattach: document.getElementById("btn-skip-rattach"),
    pointsChoice: document.getElementById("points-choice"),
    loadedPoints: document.getElementById("loaded-points"),
    loadedPointsName: document.getElementById("loaded-points-name"),
    btnChangePoints: document.getElementById("btn-change-points"),
    btnSkipPoints: document.getElementById("btn-skip-points"),
    btnContinue: document.getElementById("btn-continue"),
    continueHint: document.getElementById("continue-hint"),
    btnBack: document.getElementById("btn-back"),
    stepUpload: document.getElementById("step-upload"),
    stepViz: document.getElementById("step-viz"),
    search: document.getElementById("search"),
    toggleInactive: document.getElementById("toggle-inactive"),
    toggleRattachements: document.getElementById("toggle-rattachements"),
    togglePoints: document.getElementById("toggle-points"),
    filterCompte: document.getElementById("filter-compte"),
    filterSmViz: document.getElementById("filter-sm-viz"),
    stats: document.getElementById("stats"),
    networkDiv: document.getElementById("network"),
    emptyState: document.getElementById("empty-state"),
    tooltip: document.getElementById("tooltip"),
  };

  // état de chaque étape optionnelle : "none" (pas encore traitée) | "loaded" | "skipped"
  let rattachState = "none";
  let pointsState = "none";

  function wireDropzone(zoneEl, inputEl, onFile) {
    inputEl.addEventListener("change", (e) => {
      if (e.target.files[0]) onFile(e.target.files[0]);
    });
    ["dragover", "dragenter"].forEach((evt) =>
      zoneEl.addEventListener(evt, (e) => {
        e.preventDefault();
        zoneEl.classList.add("dragover");
      })
    );
    ["dragleave", "drop"].forEach((evt) =>
      zoneEl.addEventListener(evt, (e) => {
        e.preventDefault();
        zoneEl.classList.remove("dragover");
      })
    );
    zoneEl.addEventListener("drop", (e) => {
      const f = e.dataTransfer.files[0];
      if (f) onFile(f);
    });
  }

  function readWorkbook(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          resolve(XLSX.read(new Uint8Array(evt.target.result), { type: "array" }));
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  function sheetToRows(wb, name) {
    const sheet = wb.Sheets[name];
    if (!sheet) return [];
    return XLSX.utils.sheet_to_json(sheet, { defval: "" });
  }

  function updateContinueState() {
    // senior_manager_id vit désormais dans collaborateurs.xlsx : ce seul fichier suffit
    // déjà à afficher une hiérarchie SM. Rattachements/Réunions restent facultatifs,
    // indépendamment l'un de l'autre.
    const ready = !!raw.collab;
    els.btnContinue.disabled = !ready;
    els.continueHint.style.display = ready ? "none" : "block";
  }

  function applyCollabRows(rows, label) {
    raw.collab = rows;
    els.dzCollab.style.display = "none";
    els.loadedCollab.style.display = "flex";
    els.loadedCollabName.textContent = `${label} (${raw.collab.length} ligne(s))`;
    updateContinueState();
  }
  function applyRattachRows(rows, label) {
    raw.rattach = rows;
    rattachState = "loaded";
    els.rattachChoice.style.display = "none";
    els.loadedRattach.style.display = "flex";
    els.loadedRattachName.textContent = `${label} (${raw.rattach.length} ligne(s))`;
    updateContinueState();
  }
  function applyPointRows(rows, label) {
    raw.points = rows;
    pointsState = "loaded";
    els.pointsChoice.style.display = "none";
    els.loadedPoints.style.display = "flex";
    els.loadedPointsName.textContent = `${label} (${raw.points.length} ligne(s))`;
    updateContinueState();
  }

  wireDropzone(els.dzCollab, els.fileCollab, async (file) => {
    try {
      const wb = await readWorkbook(file);
      const rows = CartoXlsx.readCollaborateurs(wb);
      CartoState.save("collab", rows);
      applyCollabRows(rows, file.name);
    } catch (err) {
      alert("Impossible de lire ce fichier : " + err.message);
    }
  });
  els.btnChangeCollab.addEventListener("click", () => {
    raw.collab = null;
    // On ne vide pas la session ici : elle doit rester intacte jusqu'au prochain
    // upload, pour que celui-ci puisse correctement basculer l'ancienne valeur en
    // "collabPrev" (utilisé par les pages de paramétrage pour détecter les départs).
    els.fileCollab.value = "";
    els.dzCollab.style.display = "block";
    els.loadedCollab.style.display = "none";
    updateContinueState();
  });

  wireDropzone(els.dzRattach, els.fileRattach, async (file) => {
    try {
      const wb = await readWorkbook(file);
      const rows = sheetToRows(wb, "Rattachements");
      CartoState.save("rattach", rows);
      applyRattachRows(rows, file.name);
    } catch (err) {
      alert("Impossible de lire ce fichier : " + err.message);
    }
  });
  els.btnSkipRattach.addEventListener("click", () => {
    raw.rattach = null;
    rattachState = "skipped";
    CartoState.clear("rattach");
    els.rattachChoice.style.display = "none";
    els.loadedRattach.style.display = "flex";
    els.loadedRattachName.textContent = "Ignoré";
    updateContinueState();
  });
  els.btnChangeRattach.addEventListener("click", () => {
    raw.rattach = null;
    rattachState = "none";
    CartoState.clear("rattach");
    els.fileRattach.value = "";
    els.rattachChoice.style.display = "block";
    els.loadedRattach.style.display = "none";
    updateContinueState();
  });

  wireDropzone(els.dzPoints, els.filePoints, async (file) => {
    try {
      const wb = await readWorkbook(file);
      const rows = sheetToRows(wb, "Réunions");
      CartoState.save("points", rows);
      applyPointRows(rows, file.name);
    } catch (err) {
      alert("Impossible de lire ce fichier : " + err.message);
    }
  });
  els.btnSkipPoints.addEventListener("click", () => {
    raw.points = null;
    pointsState = "skipped";
    CartoState.clear("points");
    els.pointsChoice.style.display = "none";
    els.loadedPoints.style.display = "flex";
    els.loadedPointsName.textContent = "Ignoré";
    updateContinueState();
  });
  els.btnChangePoints.addEventListener("click", () => {
    raw.points = null;
    pointsState = "none";
    CartoState.clear("points");
    els.filePoints.value = "";
    els.pointsChoice.style.display = "block";
    els.loadedPoints.style.display = "none";
    updateContinueState();
  });

  // Restauration depuis la session (changement d'onglet sans réupload).
  (function hydrateFromSession() {
    const savedCollab = CartoState.load("collab");
    if (savedCollab && savedCollab.length) applyCollabRows(savedCollab, "Session précédente");
    const savedRattach = CartoState.load("rattach");
    if (savedRattach && savedRattach.length) applyRattachRows(savedRattach, "Session précédente");
    const savedPoints = CartoState.load("points");
    if (savedPoints && savedPoints.length) applyPointRows(savedPoints, "Session précédente");
  })();

  els.btnContinue.addEventListener("click", () => {
    els.stepUpload.style.display = "none";
    els.stepViz.style.display = "flex";
    els.search.disabled = false;
    mergeAndRebuild();
  });
  els.btnBack.addEventListener("click", () => {
    els.stepViz.style.display = "none";
    els.stepUpload.style.display = "block";
  });

  els.toggleInactive.addEventListener("change", rebuildGraph);
  els.toggleRattachements.addEventListener("change", rebuildGraph);
  els.togglePoints.addEventListener("change", rebuildGraph);
  els.filterCompte.addEventListener("change", rebuildGraph);
  els.filterSmViz.addEventListener("change", rebuildGraph);
  els.search.addEventListener("input", onSearch);

  // Liste des comptes de référence et des Senior Managers présents dans les données,
  // pour peupler les 2 filtres de la visualisation.
  function populateVizFilters() {
    const comptes = [...new Set(state.collaborateurs.map((c) => c.compte_reference).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b)
    );
    const prevCompte = els.filterCompte.value;
    els.filterCompte.innerHTML =
      `<option value="">Tous les comptes</option>` +
      comptes.map((c) => `<option value="${c}">${c}</option>`).join("");
    if (comptes.includes(prevCompte)) els.filterCompte.value = prevCompte;

    const sms = state.collaborateurs
      .filter((c) => c.poste === "Senior Manager")
      .sort((a, b) => collabName(a).localeCompare(collabName(b)));
    const prevSm = els.filterSmViz.value;
    els.filterSmViz.innerHTML =
      `<option value="">Tous les périmètres</option>` +
      sms.map((c) => `<option value="${c.id}">Périmètre de ${collabName(c)}</option>`).join("");
    if (sms.some((c) => c.id === prevSm)) els.filterSmViz.value = prevSm;
  }

  function mergeAndRebuild() {
    if (!raw.collab) return;

    const rattachById = {};
    (raw.rattach || []).forEach((r) => {
      const id = norm(r.id);
      if (!id) return;
      rattachById[id] = {
        manager_id: norm(r.manager_id),
        chef_de_projet_id: norm(r.chef_de_projet_id),
        compte_reference: norm(r.compte_reference),
        tags: TAG_DEFS.filter((t) => isOui(r[t.key])).map((t) => t.label),
        actif: !norm(r.actif) || isOui(r.actif),
        date_maj: norm(r.date_maj),
      };
    });

    const collaborateurs = raw.collab
      .filter((r) => norm(r.id))
      .map((r) => {
        const id = norm(r.id);
        const rat = rattachById[id] || {
          manager_id: "",
          chef_de_projet_id: "",
          compte_reference: "",
          tags: [],
          actif: true,
          date_maj: "",
        };
        return {
          id,
          nom: norm(r.nom),
          prenom: norm(r.prenom),
          poste: norm(r.poste),
          senior_manager_id: norm(r.senior_manager_id),
          ...rat,
        };
      });

    const points = (raw.points || [])
      .filter((r) => norm(r.id))
      .map((r) => ({
        id: norm(r.id),
        nom: norm(r.nom),
        animateur_id: norm(r.animateur_id),
        participants: norm(r.participants_ids)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        type: norm(r.type) || "Autre",
        periodicite: norm(r.periodicite) || "Non précisée",
        ordre_du_jour: norm(r.ordre_du_jour),
        actif: !norm(r.actif) || isOui(r.actif),
        date_maj: norm(r.date_maj),
      }));

    state = { collaborateurs, points };
    els.search.disabled = false;
    populateVizFilters();
    rebuildGraph();
  }

  function collabName(c) {
    return [c.prenom, c.nom].filter(Boolean).join(" ") || c.id;
  }

  function findCollab(id) {
    return state.collaborateurs.find((c) => c.id === id);
  }
  function findPoint(id) {
    return state.points.find((p) => p.id === id);
  }

  function encadresPar(id, field) {
    return state.collaborateurs.filter((c) => c[field] === id).map(collabName);
  }

  // Tous les points (actifs) auxquels une personne participe, comme animateur ou participant.
  function pointIdsInvolving(id) {
    const s = new Set();
    state.points
      .filter((p) => p.actif && (p.animateur_id === id || p.participants.includes(id)))
      .forEach((p) => s.add(p.id));
    return s;
  }

  // Objectif final de l'outil : ce collaborateur partage-t-il au moins un point
  // (équipe ou individuel) avec l'un de ses 3 responsables ? Si aucun responsable
  // n'est renseigné (sommet de l'UO), la question ne s'applique pas.
  function isSeenByResponsable(c) {
    const responsables = [c.senior_manager_id, c.manager_id, c.chef_de_projet_id].filter(Boolean);
    if (!responsables.length) return true;
    const own = pointIdsInvolving(c.id);
    if (!own.size) return false;
    return responsables.some((rid) => {
      const respPoints = pointIdsInvolving(rid);
      return [...own].some((pid) => respPoints.has(pid));
    });
  }

  function pointsForCollab(id) {
    const asAnimateur = state.points
      .filter((p) => p.animateur_id === id)
      .map((p) => ({ point: p, role: "Animateur" }));
    const asParticipant = state.points
      .filter((p) => p.animateur_id !== id && p.participants.includes(id))
      .map((p) => ({ point: p, role: "Participant" }));
    return [...asAnimateur, ...asParticipant];
  }

  function participantsOf(point) {
    const ids = new Set(point.participants.filter((id) => id !== point.animateur_id));
    return [...ids].map(findCollab).filter(Boolean);
  }

  function rebuildGraph() {
    const showInactive = els.toggleInactive.checked;
    const showRattachements = els.toggleRattachements.checked;
    const showPoints = els.togglePoints.checked;
    const filterCompte = els.filterCompte.value;
    const filterSm = els.filterSmViz.value;
    const hasFilter = !!(filterCompte || filterSm);

    const inScope = (c) => {
      if (filterCompte && c.compte_reference !== filterCompte) return false;
      if (filterSm && c.id !== filterSm && c.senior_manager_id !== filterSm) return false;
      return true;
    };

    const activeCollabs = state.collaborateurs.filter((c) => showInactive || c.actif);
    const activeById = new Map(activeCollabs.map((c) => [c.id, c]));
    const activePoints = showPoints ? state.points.filter((p) => showInactive || p.actif) : [];

    els.emptyState.style.display = state.collaborateurs.length === 0 ? "flex" : "none";

    // Une réunion "mixte" (certains membres dans le filtre, d'autres hors filtre) reste
    // affichée dès qu'au moins un membre est dans le filtre — ses membres hors filtre
    // sont montrés grisés (contexte) plutôt que masqués.
    const relevantPoints = activePoints.filter((p) => {
      const memberIds = [p.animateur_id, ...p.participants].filter((id) => activeById.has(id));
      if (!memberIds.length) return false;
      return !hasFilter || memberIds.some((id) => inScope(activeById.get(id)));
    });

    const contextualIds = new Set();
    if (hasFilter) {
      relevantPoints.forEach((p) => {
        [p.animateur_id, ...p.participants].forEach((id) => {
          const c = activeById.get(id);
          if (c && !inScope(c)) contextualIds.add(id);
        });
      });
    }

    const collabs = activeCollabs.filter((c) => !hasFilter || inScope(c) || contextualIds.has(c.id));
    const collabIds = new Set(collabs.map((c) => c.id));
    const scopedCollabs = hasFilter ? collabs.filter((c) => !contextualIds.has(c.id)) : collabs;

    const nodes = [];
    const edges = [];

    for (const c of collabs) {
      const isContextual = contextualIds.has(c.id);
      const role = roleOf(c.poste);
      const size = role === "SM" ? 22 : role ? 16 : 12;
      const roleColor = cssVar(roleColorVar(role));
      const mutedColor = cssVar("--node-person-inactive");
      const displayColor = isContextual || !c.actif ? mutedColor : roleColor;
      const isFragile = !isContextual && c.tags.includes("En fragilité");
      const gap = c.actif && !isSeenByResponsable(c);
      nodes.push({
        id: "c:" + c.id,
        label: collabName(c) + (role && role !== "SM" ? ` (${c.poste})` : role === "SM" ? " (SM)" : "") + (gap ? " ⚠" : ""),
        shape: "dot",
        size,
        color: {
          background: displayColor,
          border: isFragile ? cssVar("--ring-fragile") : displayColor,
          highlight: { background: roleColor, border: isFragile ? cssVar("--ring-fragile") : cssVar("--text-primary") },
        },
        font: { color: isContextual ? cssVar("--text-muted") : cssVar("--text-primary"), size: 13 },
        borderWidth: isFragile ? 3 : 1,
        opacity: isContextual ? 0.55 : 1,
        _kind: "collab",
        _refId: c.id,
        _contextual: isContextual,
      });
      if (showRattachements && !isContextual) {
        if (c.senior_manager_id && collabIds.has(c.senior_manager_id) && !contextualIds.has(c.senior_manager_id)) {
          edges.push({
            id: "sm:" + c.senior_manager_id + ">" + c.id,
            from: "c:" + c.senior_manager_id,
            to: "c:" + c.id,
            arrows: "to",
            color: { color: cssVar("--edge-hierarchy") },
            width: 1.5,
            _kind: "sm",
          });
        }
        if (c.manager_id && collabIds.has(c.manager_id) && !contextualIds.has(c.manager_id)) {
          edges.push({
            id: "mg:" + c.manager_id + ">" + c.id,
            from: "c:" + c.manager_id,
            to: "c:" + c.id,
            arrows: "to",
            dashes: true,
            color: { color: cssVar("--edge-hierarchy") },
            width: 1.5,
            _kind: "manager",
          });
        }
        if (c.chef_de_projet_id && collabIds.has(c.chef_de_projet_id) && !contextualIds.has(c.chef_de_projet_id)) {
          edges.push({
            id: "cp:" + c.chef_de_projet_id + ">" + c.id,
            from: "c:" + c.chef_de_projet_id,
            to: "c:" + c.id,
            arrows: "to",
            dashes: [2, 3],
            color: { color: cssVar("--edge-hierarchy") },
            width: 1.5,
            _kind: "cp",
          });
        }
      }
    }

    // Les réunions n'ont plus de nœud dédié :
    // - Individuelle : un simple trait entre les 2 personnes reliées (animateur <-> collaborateur).
    // - Équipe/Autre : un cercle en pointillé dessiné autour de ses membres (dans le cercle =
    //   dans la réunion), recalculé à chaque frame pour suivre les nœuds (cf. drawTeamMeetingCircles).
    teamMeetingCircles = [];
    hautPotentielNodes = collabs
      .filter((c) => !contextualIds.has(c.id) && c.tags.includes("Haut potentiel"))
      .map((c) => ({ id: "c:" + c.id, size: roleOf(c.poste) === "SM" ? 22 : roleOf(c.poste) ? 16 : 12 }));
    for (const p of relevantPoints) {
      const memberIds = [p.animateur_id, ...p.participants].filter(
        (id, idx, arr) => id && collabIds.has(id) && arr.indexOf(id) === idx
      );
      if (!memberIds.length) continue;

      if (p.type === "Individuel") {
        const other = p.participants.find((id) => id !== p.animateur_id && collabIds.has(id));
        if (p.animateur_id && collabIds.has(p.animateur_id) && other) {
          edges.push({
            id: "im:" + p.id,
            from: "c:" + p.animateur_id,
            to: "c:" + other,
            color: { color: cssVar("--edge-anim") },
            width: 2,
            _kind: "individual-meeting",
            _refId: p.id,
          });
        }
      } else {
        const nodeIds = memberIds.map((id) => "c:" + id);
        teamMeetingCircles.push({ id: p.id, point: p, memberIds: nodeIds });
        // Liens invisibles (opacité 0) entre tous les membres : sans eux, un animateur au
        // centre d'une grande hiérarchie peut se retrouver physiquement très loin de ses
        // participants, ce qui oblige la forme englobante à s'étirer sur tout le graphe et
        // à capturer des gens qui n'ont rien à voir avec cette réunion. Ces liens ne sont
        // jamais dessinés, ils servent uniquement à rapprocher réellement les membres.
        for (let i = 0; i < nodeIds.length; i++) {
          for (let j = i + 1; j < nodeIds.length; j++) {
            edges.push({
              id: `tml:${p.id}:${i}:${j}`,
              from: nodeIds[i],
              to: nodeIds[j],
              color: { color: "rgba(0,0,0,0)", opacity: 0 },
              width: 0,
              length: 70,
              physics: true,
              smooth: false,
              _kind: "team-meeting-link",
            });
          }
        }
      }
    }

    allNodesDataset = new vis.DataSet(nodes);
    allEdgesDataset = new vis.DataSet(edges);

    const options = {
      physics: {
        solver: "forceAtlas2Based",
        forceAtlas2Based: { gravitationalConstant: -60, springLength: 90, springConstant: 0.06, avoidOverlap: 0.6 },
        stabilization: { iterations: 150 },
      },
      interaction: { hover: true, tooltipDelay: 100 },
      edges: { smooth: { type: "continuous", roundness: 0.4 } },
    };

    if (network) network.destroy();
    network = new vis.Network(els.networkDiv, { nodes: allNodesDataset, edges: allEdgesDataset }, options);
    pinnedId = null;
    hoveringNode = false;
    hoveredCircleId = null;
    network.on("hoverNode", (params) => {
      hoveringNode = true;
      if (!pinnedId) onHoverNode(params.node);
    });
    network.on("hoverEdge", (params) => {
      if (!pinnedId) onHoverEdge(params.edge);
    });
    network.on("blurNode", () => {
      hoveringNode = false;
      restorePinnedOrClear();
    });
    network.on("blurEdge", () => {
      restorePinnedOrClear();
    });
    network.on("click", (params) => {
      if (params.nodes.length) {
        pinnedId = params.nodes[0];
        onHoverNode(pinnedId);
        const connected = network.getConnectedNodes(pinnedId);
        network.fit({ nodes: [pinnedId, ...connected], animation: { duration: 400 } });
        return;
      }
      const hitCircle = findCircleAt(params.pointer.canvas);
      if (hitCircle) {
        pinnedId = "circle:" + hitCircle.id;
        showCircleTooltipAndHighlight(hitCircle);
        network.fit({ nodes: hitCircle.memberIds, animation: { duration: 400 } });
        return;
      }
      pinnedId = null;
      clearHighlight();
      network.fit({ animation: { duration: 400 } });
    });
    network.on("afterDrawing", (ctx) => {
      drawTeamMeetingCircles(ctx);
      drawHautPotentielBadges(ctx);
    });
    // Survol des cercles de réunion d'équipe : vis-network ne gère pas ces formes
    // custom, donc hit-test manuel sur les coordonnées canvas de la souris.
    const canvasEl = network.canvas.frame.canvas;
    canvasEl.addEventListener("mousemove", (e) => {
      if (pinnedId || hoveringNode) return;
      const rect = canvasEl.getBoundingClientRect();
      const canvasPos = network.DOMtoCanvas({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      const hit = findCircleAt(canvasPos);
      const hitId = hit ? hit.id : null;
      if (hitId === hoveredCircleId) return;
      hoveredCircleId = hitId;
      if (hit) showCircleTooltipAndHighlight(hit);
      else clearHighlight();
    });
    network.once("stabilizationIterationsDone", () => {
      network.setOptions({ physics: false });
      network.fit({ animation: { duration: 300 } });
    });

    updateStats(scopedCollabs, relevantPoints);
  }

  // Contour "à main levée" : enveloppe convexe des membres, gonflée d'un padding puis
  // lissée (courbes passant par les milieux de chaque côté). Dessiné comme une seule
  // forme organique, pas un cercle par personne. Limite connue et acceptée : une forme
  // pleine a un intérieur, donc glisser quelqu'un d'extérieur au milieu du groupe peut
  // le faire apparaître visuellement "dedans" — il n'est jamais compté comme participant
  // dans les données, seul l'affichage peut être trompeur dans ce cas précis.
  const HULL_PADDING = 34;

  function convexHull(points) {
    if (points.length <= 2) return points.slice();
    const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  // Gonfle l'enveloppe convexe vers l'extérieur (depuis le centroïde) ; pour 1 ou 2
  // membres, construit directement un petit contour arrondi (pas d'enveloppe possible).
  function paddedBlobPolygon(points, padding) {
    if (points.length === 1) {
      const p = points[0];
      return Array.from({ length: 16 }, (_, i) => {
        const a = (i / 16) * Math.PI * 2;
        return { x: p.x + Math.cos(a) * padding, y: p.y + Math.sin(a) * padding };
      });
    }
    if (points.length === 2) {
      const [a, b] = points;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const half = Math.hypot(a.x - b.x, a.y - b.y) / 2;
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      return Array.from({ length: 20 }, (_, i) => {
        const t = (i / 20) * Math.PI * 2;
        const rx = half + padding;
        const ry = padding;
        const x = Math.cos(t) * rx;
        const y = Math.sin(t) * ry;
        return {
          x: mx + x * Math.cos(angle) - y * Math.sin(angle),
          y: my + x * Math.sin(angle) + y * Math.cos(angle),
        };
      });
    }
    const hull = convexHull(points);
    const cx = hull.reduce((s, p) => s + p.x, 0) / hull.length;
    const cy = hull.reduce((s, p) => s + p.y, 0) / hull.length;
    return hull.map((p) => {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const d = Math.hypot(dx, dy) || 1;
      return { x: p.x + (dx / d) * padding, y: p.y + (dy / d) * padding };
    });
  }

  function pointInPolygon(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x;
      const yi = poly[i].y;
      const xj = poly[j].x;
      const yj = poly[j].y;
      const intersect = yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function findCircleAt(canvasPos) {
    return teamMeetingCircles.find((tm) => tm.poly && pointInPolygon(canvasPos, tm.poly));
  }

  function drawSmoothBlobPath(poly) {
    const path = new Path2D();
    const n = poly.length;
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const start = mid(poly[n - 1], poly[0]);
    path.moveTo(start.x, start.y);
    for (let i = 0; i < n; i++) {
      const cur = poly[i];
      const next = poly[(i + 1) % n];
      const m = mid(cur, next);
      path.quadraticCurveTo(cur.x, cur.y, m.x, m.y);
    }
    path.closePath();
    return path;
  }

  function drawTeamMeetingCircles(ctx) {
    if (!network || !teamMeetingCircles.length) return;
    const color = cssVar("--edge-anim");
    const textColor = cssVar("--text-primary");
    teamMeetingCircles.forEach((tm) => {
      const positions = network.getPositions(tm.memberIds);
      const pts = tm.memberIds.map((id) => positions[id]).filter(Boolean);
      if (!pts.length) return;
      const poly = paddedBlobPolygon(pts, HULL_PADDING);
      tm.poly = poly;
      const cx = pts.reduce((s, pt) => s + pt.x, 0) / pts.length;
      const cy = pts.reduce((s, pt) => s + pt.y, 0) / pts.length;

      const active = pinnedId === "circle:" + tm.id || hoveredCircleId === tm.id;
      const fillColor = active ? textColor : color;
      const path = drawSmoothBlobPath(poly);

      ctx.save();
      ctx.globalAlpha = pinnedId && !active ? 0.06 : 0.16;
      ctx.fillStyle = fillColor;
      ctx.fill(path);

      ctx.globalAlpha = pinnedId && !active ? 0.15 : 1;
      ctx.lineWidth = active ? 2.5 : 1.5;
      ctx.strokeStyle = fillColor;
      ctx.stroke(path);
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = pinnedId && !active ? 0.25 : 1;
      ctx.fillStyle = fillColor;
      ctx.font = "12px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      const labelY = Math.min(...poly.map((p) => p.y)) - 8;
      ctx.fillText(tm.point.nom || "Réunion d'équipe", cx, labelY);
      ctx.restore();
    });
  }

  // Pastille jaune toujours visible (en plus du survol) en coin haut-droit du nœud,
  // pour repérer les hauts potentiels d'un coup d'œil sans avoir à survoler chacun.
  function drawHautPotentielBadges(ctx) {
    if (!network || !hautPotentielNodes.length) return;
    const color = cssVar("--status-warning");
    const ids = hautPotentielNodes.map((n) => n.id);
    const positions = network.getPositions(ids);
    hautPotentielNodes.forEach(({ id, size }) => {
      const p = positions[id];
      if (!p) return;
      const bx = p.x + size * 0.7;
      const by = p.y - size * 0.7;
      ctx.save();
      ctx.beginPath();
      ctx.arc(bx, by, 5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = cssVar("--surface-1") || "#1a1a1a";
      ctx.stroke();
      ctx.restore();
    });
  }

  function showCircleTooltipAndHighlight(tm) {
    highlight(tm.memberIds, []);
    showTooltip(pointTooltipHtml(tm.point));
    positionTooltipAtMouse();
  }

  function restorePinnedOrClear() {
    if (!pinnedId) {
      clearHighlight();
      return;
    }
    if (pinnedId.startsWith("circle:")) {
      const tm = teamMeetingCircles.find((t) => "circle:" + t.id === pinnedId);
      if (tm) showCircleTooltipAndHighlight(tm);
      else clearHighlight();
    } else {
      onHoverNode(pinnedId);
    }
  }

  function updateStats(collabs, points) {
    const nbActive = collabs.filter((c) => c.actif).length;
    const nbGap = collabs.filter((c) => c.actif && !isSeenByResponsable(c)).length;
    els.stats.textContent =
      `${nbActive} collaborateur(s) actif(s) · ${points.filter((p) => p.actif).length} réunion(s) active(s)` +
      (nbGap ? ` · ⚠ ${nbGap} sans réunion commune avec un responsable` : "");
  }

  function tagPillsHtml(tags) {
    if (!tags.length) return "";
    const byLabel = Object.fromEntries(TAG_DEFS.map((t) => [t.label, t]));
    return `<div class="tt-pills">${tags
      .map((label) => {
        const def = byLabel[label];
        const style = `background:${cssVar(def.color)};${def.textColor ? `color:${def.textColor}` : ""}`;
        return `<span class="pill" style="${style}">${label}</span>`;
      })
      .join("")}</div>`;
  }

  function pointTooltipHtml(p) {
    const anim = p.animateur_id ? findCollab(p.animateur_id) : null;
    const animLabel = anim ? collabName(anim) : p.animateur_id;
    const parts = participantsOf(p);
    return `
      <div class="tt-title">${p.nom || "Réunion sans nom"}</div>
      <div class="tt-sub">${p.type} · ${p.periodicite}${p.actif ? "" : " · inactif"}</div>
      ${animLabel ? `<div class="tt-row"><span class="tt-label">Animateur :</span> ${animLabel}</div>` : ""}
      ${parts.length ? `<div class="tt-row"><span class="tt-label">Participants :</span><ul class="tt-list">${parts.map((c) => `<li>${collabName(c)}</li>`).join("")}</ul></div>` : ""}
      ${p.ordre_du_jour ? `<div class="tt-row" style="margin-top:8px"><span class="tt-label">Ordre du jour :</span> ${p.ordre_du_jour}</div>` : ""}
    `;
  }

  function onHoverNode(nodeId) {
    const node = allNodesDataset.get(nodeId);
    if (!node) return;
    const connectedNodeIds = network.getConnectedNodes(nodeId);
    const connectedEdgeIds = network.getConnectedEdges(nodeId);
    highlight([nodeId, ...connectedNodeIds], connectedEdgeIds);

    const c = findCollab(node._refId);
    const sm = c.senior_manager_id ? findCollab(c.senior_manager_id) : null;
    const mgr = c.manager_id ? findCollab(c.manager_id) : null;
    const cp = c.chef_de_projet_id ? findCollab(c.chef_de_projet_id) : null;
    const pts = pointsForCollab(c.id);
    const smOf = encadresPar(c.id, "senior_manager_id");
    const mgrOf = encadresPar(c.id, "manager_id");
    const cpOf = encadresPar(c.id, "chef_de_projet_id");
    showTooltip(`
      <div class="tt-title">${collabName(c)}</div>
      <div class="tt-sub">${c.poste || "Poste non précisé"}${c.actif ? "" : " · inactif"}</div>
      ${node._contextual ? `<div class="tt-row" style="color:var(--text-muted)">Hors du filtre actuel — affiché car présent dans une réunion filtrée</div>` : ""}
      <div class="tt-row"><span class="tt-label">Senior Manager :</span> ${sm ? collabName(sm) : c.senior_manager_id || "— (SM de tête)"}</div>
      ${mgr ? `<div class="tt-row"><span class="tt-label">Manager :</span> ${collabName(mgr)}</div>` : c.manager_id ? `<div class="tt-row"><span class="tt-label">Manager :</span> ${c.manager_id}</div>` : ""}
      ${cp ? `<div class="tt-row"><span class="tt-label">Chef de projet :</span> ${collabName(cp)}</div>` : c.chef_de_projet_id ? `<div class="tt-row"><span class="tt-label">Chef de projet :</span> ${c.chef_de_projet_id}</div>` : ""}
      ${c.compte_reference ? `<div class="tt-row"><span class="tt-label">Compte de référence :</span> ${c.compte_reference}</div>` : ""}
      ${tagPillsHtml(c.tags)}
      ${smOf.length ? `<div class="tt-row" style="margin-top:8px"><span class="tt-label">SM de :</span> ${smOf.join(", ")}</div>` : ""}
      ${mgrOf.length ? `<div class="tt-row"><span class="tt-label">Manager de :</span> ${mgrOf.join(", ")}</div>` : ""}
      ${cpOf.length ? `<div class="tt-row"><span class="tt-label">CP de :</span> ${cpOf.join(", ")}</div>` : ""}
      ${pts.length ? `<div class="tt-row" style="margin-top:8px"><span class="tt-label">Réunions :</span><ul class="tt-list">${pts.map((x) => `<li>${x.point.nom || "Réunion individuelle"} — ${x.role} (${x.point.periodicite})</li>`).join("")}</ul></div>` : ""}
      ${c.actif && !isSeenByResponsable(c) ? `<div class="tt-row" style="margin-top:8px;color:var(--ring-fragile)">⚠ Aucune réunion commune avec un responsable (SM/Manager/CP)</div>` : ""}
    `);
    positionTooltipAtMouse();
  }

  function onHoverEdge(edgeId) {
    const edge = allEdgesDataset.get(edgeId);
    if (!edge) return;
    highlight([edge.from, edge.to], [edgeId]);
    if (edge._kind === "individual-meeting") {
      const p = findPoint(edge._refId);
      if (p) {
        showTooltip(pointTooltipHtml(p));
        positionTooltipAtMouse();
      }
    }
  }

  // Un collaborateur "hors filtre affiché en contexte" garde une opacité de base réduite
  // en permanence (cf. rebuildGraph) : la surbrillance/l'effacement doivent la restaurer
  // plutôt que de la remettre à 1 comme pour un nœud normal.
  function baseOpacityOf(node) {
    return node._contextual ? 0.55 : 1;
  }

  function highlight(nodeIds, edgeIds) {
    const nodeSet = new Set(nodeIds);
    const edgeSet = new Set(edgeIds);
    const nodeUpdates = allNodesDataset.get().map((n) => ({
      id: n.id,
      opacity: nodeSet.has(n.id) ? 1 : 0.15,
    }));
    const edgeUpdates = allEdgesDataset.get().map((e) => ({
      id: e.id,
      hidden: false,
      color: { ...e.color, opacity: e._kind === "team-meeting-link" ? 0 : edgeSet.has(e.id) ? 1 : 0.08 },
    }));
    allNodesDataset.update(nodeUpdates);
    allEdgesDataset.update(edgeUpdates);
  }

  function clearHighlight() {
    if (!allNodesDataset) return;
    allNodesDataset.update(allNodesDataset.get().map((n) => ({ id: n.id, opacity: baseOpacityOf(n) })));
    allEdgesDataset.update(
      allEdgesDataset.get().map((e) => ({ id: e.id, color: { ...e.color, opacity: e._kind === "team-meeting-link" ? 0 : 1 } }))
    );
    hideTooltip();
  }

  function showTooltip(html) {
    els.tooltip.innerHTML = html;
    els.tooltip.style.display = "block";
  }
  function hideTooltip() {
    els.tooltip.style.display = "none";
  }

  let lastMouse = { x: 0, y: 0 };
  document.addEventListener("mousemove", (e) => {
    lastMouse = { x: e.clientX, y: e.clientY };
    if (els.tooltip.style.display === "block") positionTooltipAtMouse();
  });
  function positionTooltipAtMouse() {
    const pad = 16;
    let x = lastMouse.x + pad;
    let y = lastMouse.y + pad;
    const rect = els.tooltip.getBoundingClientRect();
    if (x + rect.width > window.innerWidth) x = lastMouse.x - rect.width - pad;
    if (y + rect.height > window.innerHeight) y = lastMouse.y - rect.height - pad;
    els.tooltip.style.left = x + "px";
    els.tooltip.style.top = y + "px";
  }

  function onSearch(e) {
    const q = e.target.value.trim().toLowerCase();
    if (!q || !allNodesDataset) {
      pinnedId = null;
      if (allNodesDataset) clearHighlight();
      return;
    }
    hideTooltip();
    // Les réunions d'équipe n'ont plus de nœud (elles sont dessinées en cercle) : on les
    // cherche séparément par leur nom pour que la recherche continue à les trouver.
    const nodeMatches = allNodesDataset.get().filter((n) => n.label.toLowerCase().includes(q));
    const circleMatches = teamMeetingCircles.filter((tm) => (tm.point.nom || "").toLowerCase().includes(q));
    if (!nodeMatches.length && !circleMatches.length) return;

    if (nodeMatches.length === 1 && !circleMatches.length) {
      pinnedId = nodeMatches[0].id;
      network.selectNodes([pinnedId]);
      network.focus(pinnedId, { scale: 1.1, animation: true });
      onHoverNode(pinnedId);
      return;
    }
    if (circleMatches.length === 1 && !nodeMatches.length) {
      const tm = circleMatches[0];
      pinnedId = "circle:" + tm.id;
      showCircleTooltipAndHighlight(tm);
      network.fit({ nodes: tm.memberIds, animation: true });
      return;
    }
    const ids = new Set(nodeMatches.map((n) => n.id));
    circleMatches.forEach((tm) => tm.memberIds.forEach((id) => ids.add(id)));
    network.selectNodes(nodeMatches.map((n) => n.id));
    network.fit({ nodes: [...ids], animation: true });
  }
})();
