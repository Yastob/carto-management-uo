(function () {
  "use strict";

  const TAG_DEFS = [
    { key: "tag_haut_potentiel", label: "Haut potentiel", color: "--status-warning", textColor: "#000" },
    { key: "tag_en_fragilite", label: "En fragilité", color: "--status-critical" },
    { key: "tag_consultant_isole", label: "Consultant isolé", color: "--slot-magenta" },
  ];

  // Déclaré tout en haut (et non près de son usage plus bas) : hydrateFromSession()
  // s'exécute très tôt au chargement du script et peut restaurer des fichiers de session,
  // déclenchant un calcul de fusion qui lit cette constante — une déclaration plus tardive
  // provoquerait une erreur de zone morte temporelle (TDZ) à ce moment-là.
  const RATTACH_TEXT_FIELDS = [
    { key: "manager_id", label: "Manager" },
    { key: "chef_de_projet_id", label: "Chef de projet" },
    { key: "consultant_referent_id", label: "Consultant référent" },
    { key: "compte_reference", label: "Compte de référence" },
  ];

  // (Déclaré ici pour la même raison que RATTACH_TEXT_FIELDS.)
  // Zone de contrôle pour l'Île-de-France (rectangle large) : sert uniquement à signaler
  // une adresse manifestement hors zone, pas à filtrer.
  const IDF_BOUNDS = { latMin: 48.1, latMax: 49.25, lonMin: 1.4, lonMax: 3.6 };
  const CONSULTANT_SECTORIEL = "Consultant Sectoriel";
  const parseCoord = (v) => {
    const n = parseFloat(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };

  // Palette Okabe-Ito : conçue pour rester distinguable en cas de daltonisme
  // (protanopie/deutéranopie/tritanopie), volontairement sans paire rouge/vert.
  const PERIODICITE_ORDER = ["Hebdomadaire", "2 fois par mois", "Mensuel", "Tous les 2 mois", "Ponctuel"];
  const PERIODICITE_COLORS = {
    Hebdomadaire: "#0072B2",
    "2 fois par mois": "#56B4E9",
    Mensuel: "#009E73",
    "Tous les 2 mois": "#E69F00",
    Ponctuel: "#D55E00",
  };
  const PERIODICITE_DEFAULT_COLOR = "#9a9a9a"; // périodicité "Autre" ou non reconnue
  function periodiciteColor(periodicite) {
    return PERIODICITE_COLORS[periodicite] || PERIODICITE_DEFAULT_COLOR;
  }

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
  let selectedIds = new Set(); // sélection multiple (Ctrl/Maj+clic), indépendante de pinnedId
  let colorByPeriodicite = false; // lu par drawTeamMeetingCircles, hors de la portée de rebuildGraph
  let teamMeetingCircles = []; // réunions non-individuelles : dessinées en cercle, pas en nœud
  let hoveredCircleId = null;
  let hautPotentielNodes = []; // {id, size} : pastille jaune toujours visible, en plus du survol
  let state = { collaborateurs: [], points: [] };
  // rattachFiles/pointsFiles : {name, rows}[] — un fichier par Senior Manager, fusionnés
  // ensemble (cf. computeMergedState).
  let raw = { collab: null, rattachFiles: [], pointsFiles: [] };

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
    loadedRattachList: document.getElementById("loaded-rattach-list"),
    loadedPointsList: document.getElementById("loaded-points-list"),
    consistencyReport: document.getElementById("consistency-report"),
    btnContinue: document.getElementById("btn-continue"),
    continueHint: document.getElementById("continue-hint"),
    btnBack: document.getElementById("btn-back"),
    stepUpload: document.getElementById("step-upload"),
    stepViz: document.getElementById("step-viz"),
    search: document.getElementById("search"),
    toggleRattachements: document.getElementById("toggle-rattachements"),
    togglePoints: document.getElementById("toggle-points"),
    pointsTypeFilters: document.getElementById("points-type-filters"),
    togglePointsIndividuel: document.getElementById("toggle-points-individuel"),
    togglePointsEquipe: document.getElementById("toggle-points-equipe"),
    togglePeriodicite: document.getElementById("toggle-periodicite"),
    legendPeriodicite: document.getElementById("legend-periodicite"),
    legendPeriodiciteRows: document.getElementById("legend-periodicite-rows"),
    filterCompte: document.getElementById("filter-compte"),
    filterSmViz: document.getElementById("filter-sm-viz"),
    stats: document.getElementById("stats"),
    networkDiv: document.getElementById("network"),
    emptyState: document.getElementById("empty-state"),
    tooltip: document.getElementById("tooltip"),
  };

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

  // Variante multi-fichiers (rattachements/réunions : un fichier par Senior Manager,
  // on peut en déposer plusieurs à la fois ou successivement).
  function wireDropzoneMulti(zoneEl, inputEl, onFiles) {
    inputEl.addEventListener("change", (e) => {
      if (e.target.files.length) onFiles([...e.target.files]);
      inputEl.value = ""; // permet de resélectionner le même fichier après un retrait
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
      if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]);
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
    updateConsistencyPreview();
  }

  function renderLoadedFilesList(container, files, onRemove) {
    container.innerHTML = files
      .map(
        (f, i) => `
      <div class="loaded-row">
        <span class="ok-icon">✓</span>
        <span class="loaded-name">${f.name} (${f.rows.length} ligne(s))</span>
        <button class="btn btn-secondary btn-small" data-idx="${i}">Retirer</button>
      </div>`
      )
      .join("");
    container.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => onRemove(Number(btn.dataset.idx)));
    });
  }
  function renderRattachList() {
    renderLoadedFilesList(els.loadedRattachList, raw.rattachFiles, (idx) => {
      raw.rattachFiles.splice(idx, 1);
      CartoState.save("rattachFiles", raw.rattachFiles);
      renderRattachList();
      updateConsistencyPreview();
    });
  }
  function renderPointsList() {
    renderLoadedFilesList(els.loadedPointsList, raw.pointsFiles, (idx) => {
      raw.pointsFiles.splice(idx, 1);
      CartoState.save("pointsFiles", raw.pointsFiles);
      renderPointsList();
      updateConsistencyPreview();
    });
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
    updateConsistencyPreview();
  });

  wireDropzoneMulti(els.dzRattach, els.fileRattach, async (files) => {
    for (const file of files) {
      try {
        const wb = await readWorkbook(file);
        const rows = sheetToRows(wb, "Rattachements");
        raw.rattachFiles.push({ name: file.name, rows });
      } catch (err) {
        alert(`Impossible de lire "${file.name}" : ${err.message}`);
      }
    }
    CartoState.save("rattachFiles", raw.rattachFiles);
    renderRattachList();
    updateConsistencyPreview();
  });

  wireDropzoneMulti(els.dzPoints, els.filePoints, async (files) => {
    for (const file of files) {
      try {
        const wb = await readWorkbook(file);
        const rows = sheetToRows(wb, "Réunions");
        raw.pointsFiles.push({ name: file.name, rows });
      } catch (err) {
        alert(`Impossible de lire "${file.name}" : ${err.message}`);
      }
    }
    CartoState.save("pointsFiles", raw.pointsFiles);
    renderPointsList();
    updateConsistencyPreview();
  });

  // Restauration depuis la session (changement d'onglet sans réupload).
  (function hydrateFromSession() {
    const savedCollab = CartoState.load("collab");
    if (savedCollab && savedCollab.length) applyCollabRows(savedCollab, "Session précédente");
    raw.rattachFiles = CartoState.load("rattachFiles") || [];
    raw.pointsFiles = CartoState.load("pointsFiles") || [];
    renderRattachList();
    renderPointsList();
    updateConsistencyPreview();
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

  function updatePointsTypeFiltersVisibility() {
    els.pointsTypeFilters.style.display = els.togglePoints.checked ? "flex" : "none";
  }
  updatePointsTypeFiltersVisibility();

  function renderPeriodiciteLegend() {
    els.legendPeriodiciteRows.innerHTML = PERIODICITE_ORDER.map(
      (label) =>
        `<div class="legend-row"><span class="legend-swatch" style="background:${PERIODICITE_COLORS[label]}"></span> ${label}</div>`
    ).join("") + `<div class="legend-row"><span class="legend-swatch" style="background:${PERIODICITE_DEFAULT_COLOR}"></span> Autre / non précisée</div>`;
  }
  renderPeriodiciteLegend();

  function updatePeriodiciteLegendVisibility() {
    els.legendPeriodicite.style.display = els.togglePeriodicite.checked ? "block" : "none";
  }
  updatePeriodiciteLegendVisibility();

  els.toggleRattachements.addEventListener("change", rebuildGraph);
  els.togglePoints.addEventListener("change", () => {
    updatePointsTypeFiltersVisibility();
    rebuildGraph();
  });
  els.togglePointsIndividuel.addEventListener("change", rebuildGraph);
  els.togglePointsEquipe.addEventListener("change", rebuildGraph);
  els.togglePeriodicite.addEventListener("change", () => {
    updatePeriodiciteLegendVisibility();
    rebuildGraph();
  });
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

  // --- Fusion multi-fichiers (un rattachements.xlsx / reunions.xlsx par Senior Manager) ---
  //
  // rattachements.xlsx téléchargé contient TOUJOURS tout le monde (le filtre SM n'affecte
  // que l'affichage, pas le téléchargement) : la plupart des lignes d'un fichier donné sont
  // donc vides en dehors du périmètre de son auteur. On fusionne champ par champ plutôt que
  // ligne par ligne : un champ resté vide dans un fichier ne doit jamais écraser une valeur
  // réelle apportée par un autre. Les tags (booléens) sont fusionnés en "OR" (vrai si un
  // seul fichier dit "Oui") pour la même raison — un "Non" par défaut ne doit jamais
  // effacer un "Oui" saisi ailleurs. Un vrai conflit (2 fichiers, 2 valeurs non vides
  // différentes) est remonté dans le rapport de cohérence plutôt que tranché au hasard.
  function mergeRattachFiles(files, collabIds, nameOf, posteOf) {
    const byId = {};
    const errors = [];
    const warnings = [];
    files.forEach((file) => {
      file.rows.forEach((row) => {
        const id = norm(row.id);
        if (!id) return;
        if (collabIds && !collabIds.has(id)) {
          errors.push(
            `« ${file.name} » contient un rattachement pour l'id "${id}", introuvable dans collaborateurs.xlsx. Cette ligne est ignorée — vérifie que la personne n'a pas été supprimée ou que l'id n'est pas mal saisi.`
          );
          return;
        }
        if (!byId[id]) {
          byId[id] = {
            fields: {},
            tags: { tag_haut_potentiel: false, tag_en_fragilite: false, tag_consultant_isole: false },
            date_maj: "",
          };
        }
        const entry = byId[id];
        RATTACH_TEXT_FIELDS.forEach(({ key, label }) => {
          const val = norm(row[key]);
          if (!val) return;
          if (!entry.fields[key]) entry.fields[key] = { value: val, files: [file.name] };
          else if (entry.fields[key].value === val) entry.fields[key].files.push(file.name);
          else {
            errors.push(
              `Conflit sur ${nameOf(id)} (${id}) — champ "${label}" : "${entry.fields[key].value}" (${entry.fields[key].files.join(", ")}) vs "${val}" (${file.name}). Choisis la bonne valeur et recharge le fichier corrigé.`
            );
          }
        });
        // Adresse de mission : même règle que les autres champs texte (1er non vide gagne,
        // conflit = erreur). lat/lon sont liés à l'adresse et suivent la même valeur.
        const adr = norm(row.adresse_mission);
        if (adr) {
          const lat = parseCoord(row.lat);
          const lon = parseCoord(row.lon);
          if (!entry.adresse) entry.adresse = { value: adr, lat, lon, files: [file.name] };
          else if (entry.adresse.value === adr) {
            entry.adresse.files.push(file.name);
            if (entry.adresse.lat === null && lat !== null && lon !== null) {
              entry.adresse.lat = lat;
              entry.adresse.lon = lon;
            }
          } else {
            errors.push(
              `Conflit sur ${nameOf(id)} (${id}) — champ "Adresse de mission" : "${entry.adresse.value}" (${entry.adresse.files.join(", ")}) vs "${adr}" (${file.name}). Choisis la bonne valeur et recharge le fichier corrigé.`
            );
          }
        }
        TAG_DEFS.forEach((t) => {
          if (isOui(row[t.key])) entry.tags[t.key] = true;
        });
        if (norm(row.date_maj)) entry.date_maj = norm(row.date_maj);
      });
    });

    const rattachById = {};
    Object.entries(byId).forEach(([id, entry]) => {
      rattachById[id] = {
        manager_id: entry.fields.manager_id ? entry.fields.manager_id.value : "",
        chef_de_projet_id: entry.fields.chef_de_projet_id ? entry.fields.chef_de_projet_id.value : "",
        consultant_referent_id: entry.fields.consultant_referent_id ? entry.fields.consultant_referent_id.value : "",
        compte_reference: entry.fields.compte_reference ? entry.fields.compte_reference.value : "",
        adresse_mission: entry.adresse ? entry.adresse.value : "",
        lat: entry.adresse ? entry.adresse.lat : null,
        lon: entry.adresse ? entry.adresse.lon : null,
        tags: TAG_DEFS.filter((t) => entry.tags[t.key]).map((t) => t.label),
        date_maj: entry.date_maj,
      };
    });
    // Consultant référent : réservé aux Consultants, et le référent doit lui-même être un
    // Consultant de cette UO (ou "Consultant Sectoriel" pour quelqu'un hors UO).
    Object.entries(rattachById).forEach(([id, r]) => {
      const ref = r.consultant_referent_id;
      if (!ref) return;
      if (posteOf(id) && posteOf(id) !== "Consultant") {
        warnings.push(
          `${nameOf(id)} (${id}) est ${posteOf(id)} : un consultant référent ne peut être renseigné que pour un Consultant. Ce lien est ignoré dans la cartographie.`
        );
        r.consultant_referent_id = "";
        return;
      }
      if (ref === CONSULTANT_SECTORIEL) return;
      if (ref === id) {
        errors.push(`${nameOf(id)} (${id}) est renseigné comme son propre consultant référent. Ce lien est ignoré.`);
        r.consultant_referent_id = "";
      } else if (collabIds && !collabIds.has(ref)) {
        errors.push(
          `${nameOf(id)} (${id}) a pour consultant référent l'id "${ref}", introuvable dans collaborateurs.xlsx. Ce lien est ignoré.`
        );
        r.consultant_referent_id = "";
      } else if (posteOf(ref) && posteOf(ref) !== "Consultant") {
        warnings.push(
          `${nameOf(id)} (${id}) a pour consultant référent ${nameOf(ref)}, qui est ${posteOf(ref)} et non Consultant — utilise plutôt les colonnes Manager / Chef de projet.`
        );
      }
    });

    Object.entries(rattachById).forEach(([id, r]) => {
      if (!r.adresse_mission) return;
      if (r.lat === null || r.lon === null) {
        warnings.push(
          `${nameOf(id)} (${id}) : l'adresse de mission « ${r.adresse_mission} » n'a pas de coordonnées — elle n'apparaît pas sur la carte. Ressaisis-la dans l'éditeur de rattachements en choisissant une suggestion.`
        );
      } else if (r.lat < IDF_BOUNDS.latMin || r.lat > IDF_BOUNDS.latMax || r.lon < IDF_BOUNDS.lonMin || r.lon > IDF_BOUNDS.lonMax) {
        warnings.push(
          `${nameOf(id)} (${id}) : l'adresse de mission « ${r.adresse_mission} » semble hors d'Île-de-France — vérifie-la (elle reste affichée sur la carte, hors de la zone visible par défaut).`
        );
      }
    });
    return { rattachById, errors, warnings };
  }

  function parsePointRow(row) {
    return {
      nom: norm(row.nom),
      animateur_id: norm(row.animateur_id),
      participants: new Set(
        norm(row.participants_ids).split(",").map((s) => s.trim()).filter(Boolean)
      ),
      type: norm(row.type) || "Individuel",
      periodicite: norm(row.periodicite) || "Non précisée",
      ordre_du_jour: norm(row.ordre_du_jour),
      date_maj: norm(row.date_maj),
    };
  }
  function samePointContent(a, b) {
    if (a.animateur_id !== b.animateur_id) return false;
    if (a.participants.size !== b.participants.size) return false;
    for (const p of a.participants) if (!b.participants.has(p)) return false;
    return true;
  }

  function mergePointsFiles(files, collabIds, nameOf) {
    const byId = {};
    const allPoints = []; // pour la détection de doublons cross-fichiers
    const errors = [];
    const warnings = [];

    files.forEach((file) => {
      file.rows.forEach((row) => {
        const id = norm(row.id);
        if (!id) return;
        const point = { id, ...parsePointRow(row) };
        if (byId[id]) {
          if (!samePointContent(byId[id].point, point)) {
            errors.push(
              `« ${file.name} » et « ${byId[id].file} » contiennent tous les deux une réunion "${id}" (${point.nom || byId[id].point.nom || "sans nom"}) mais avec un contenu différent (animateur ou participants). Renomme l'id dans l'un des deux fichiers avant de le recharger.`
            );
          }
          return; // on garde la 1ère version rencontrée
        }
        byId[id] = { point, file: file.name };
        allPoints.push({ point, file: file.name });
      });
    });

    if (collabIds) {
      allPoints.forEach(({ point, file }) => {
        const unknown = [point.animateur_id, ...point.participants].filter((pid) => pid && !collabIds.has(pid));
        [...new Set(unknown)].forEach((pid) => {
          errors.push(
            `La réunion "${point.nom || point.id}" (${file}) référence l'id "${pid}", introuvable dans collaborateurs.xlsx. Cette personne ne sera pas affichée.`
          );
        });
      });
    }

    // Doublon probable : même animateur + mêmes participants, dans 2 fichiers différents.
    for (let i = 0; i < allPoints.length; i++) {
      for (let j = i + 1; j < allPoints.length; j++) {
        const a = allPoints[i];
        const b = allPoints[j];
        if (a.file === b.file) continue;
        if (samePointContent(a.point, b.point)) {
          warnings.push(
            `Ces 2 réunions semblent être la même : "${a.point.nom || a.point.id}" (${a.file}) et "${b.point.nom || b.point.id}" (${b.file}) — même animateur et mêmes participants. Si c'est un doublon, supprime l'une des deux dans son fichier d'origine.`
          );
        }
      }
    }

    const points = Object.values(byId).map(({ point }) => ({ ...point, participants: [...point.participants] }));
    return { points, errors, warnings };
  }

  function computeMergedState() {
    const idToName = {};
    (raw.collab || [])
      .filter((r) => norm(r.id))
      .forEach((r) => {
        idToName[norm(r.id)] = collabName({ id: norm(r.id), nom: norm(r.nom), prenom: norm(r.prenom) });
      });
    const collabIds = raw.collab ? new Set(Object.keys(idToName)) : null;
    const nameOf = (id) => idToName[id] || id;
    const posteByIdMap = {};
    (raw.collab || []).filter((r) => norm(r.id)).forEach((r) => (posteByIdMap[norm(r.id)] = norm(r.poste)));
    const posteOf = (id) => posteByIdMap[id] || "";

    const { rattachById, errors: rattachErrors, warnings: rattachWarnings } = mergeRattachFiles(raw.rattachFiles, collabIds, nameOf, posteOf);
    const { points, errors: pointErrors, warnings } = mergePointsFiles(raw.pointsFiles, collabIds, nameOf);

    const collaborateurs = (raw.collab || [])
      .filter((r) => norm(r.id))
      .map((r) => {
        const id = norm(r.id);
        const rat = rattachById[id] || {
          manager_id: "",
          chef_de_projet_id: "",
          consultant_referent_id: "",
          compte_reference: "",
          adresse_mission: "",
          lat: null,
          lon: null,
          tags: [],
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

    return { collaborateurs, points, report: { errors: rattachErrors.concat(pointErrors), warnings: rattachWarnings.concat(warnings) } };
  }

  function renderConsistencyReport(report) {
    const { errors, warnings } = report;
    if (!errors.length && !warnings.length) {
      els.consistencyReport.style.display = "none";
      els.consistencyReport.innerHTML = "";
      return;
    }
    els.consistencyReport.style.display = "block";
    els.consistencyReport.innerHTML =
      (errors.length
        ? `<h3 class="errors">🔴 Erreurs (${errors.length})</h3><ul>${errors.map((m) => `<li>${m}</li>`).join("")}</ul>`
        : "") +
      (warnings.length
        ? `<h3 class="warnings">🟠 Avertissements (${warnings.length})</h3><ul>${warnings.map((m) => `<li>${m}</li>`).join("")}</ul>`
        : "");
  }

  // Recalcule le rapport dès qu'un fichier est ajouté/retiré, avant même de cliquer sur
  // "Continuer" : plus tôt l'utilisateur voit une incohérence, plus vite il la corrige.
  function updateConsistencyPreview() {
    renderConsistencyReport(computeMergedState().report);
  }

  function mergeAndRebuild() {
    if (!raw.collab) return;
    const merged = computeMergedState();
    state = { collaborateurs: merged.collaborateurs, points: merged.points };
    renderConsistencyReport(merged.report);
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

  // Tous les points auxquels une personne participe, comme animateur ou participant.
  function pointIdsInvolving(id) {
    const s = new Set();
    state.points
      .filter((p) => p.animateur_id === id || p.participants.includes(id))
      .forEach((p) => s.add(p.id));
    return s;
  }

  // Objectif final de l'outil : ce collaborateur partage-t-il au moins un point
  // (équipe ou individuel) avec l'un de ses 3 responsables ? Si aucun responsable
  // n'est renseigné (sommet de l'UO), la question ne s'applique pas.
  // Résultat à 3 niveaux :
  //   "ok"       — réunion commune avec un SM/Manager/CP (ou aucun responsable à qui en demander)
  //   "referent" — aucune avec SM/Manager/CP, mais une avec son consultant référent (alerte jaune)
  //   "gap"      — aucune réunion commune avec un responsable ni avec un référent (alerte rouge)
  function followUpStatus(c) {
    const referent = findCollab(c.consultant_referent_id) ? c.consultant_referent_id : "";
    const responsables = [c.senior_manager_id, c.manager_id, c.chef_de_projet_id].filter(Boolean);
    if (!responsables.length && !referent) return "ok";
    const own = pointIdsInvolving(c.id);
    const shares = (rid) => {
      const respPoints = pointIdsInvolving(rid);
      return [...own].some((pid) => respPoints.has(pid));
    };
    if (own.size && responsables.some(shares)) return "ok";
    if (own.size && referent && shares(referent)) return "referent";
    return "gap";
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

  // Point d'entrée unique appelé par tous les filtres/toggles : reconstruit le graphe puis
  // prévient la vue Carte (carte.js) pour qu'elle se recale sur le même état filtré.
  function rebuildGraph() {
    rebuildNetwork();
    if (window.CartoMap) window.CartoMap.refresh();
  }

  function rebuildNetwork() {
    const showRattachements = els.toggleRattachements.checked;
    const showPoints = els.togglePoints.checked;
    const showPointsIndividuel = els.togglePointsIndividuel.checked;
    const showPointsEquipe = els.togglePointsEquipe.checked;
    colorByPeriodicite = els.togglePeriodicite.checked;
    const filterCompte = els.filterCompte.value;
    const filterSm = els.filterSmViz.value;
    const hasFilter = !!(filterCompte || filterSm);

    const inScope = (c) => {
      if (filterCompte && c.compte_reference !== filterCompte) return false;
      if (filterSm && c.id !== filterSm && c.senior_manager_id !== filterSm) return false;
      return true;
    };

    const activeCollabs = state.collaborateurs;
    const activeById = new Map(activeCollabs.map((c) => [c.id, c]));
    const activePoints = showPoints
      ? state.points.filter((p) => (p.type === "Individuel" ? showPointsIndividuel : showPointsEquipe))
      : [];

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
      const mutedColor = cssVar("--node-person-muted");
      const displayColor = isContextual ? mutedColor : roleColor;
      const isFragile = !isContextual && c.tags.includes("En fragilité");
      const followUp = followUpStatus(c);
      nodes.push({
        id: "c:" + c.id,
        label: collabName(c) + (role && role !== "SM" ? ` (${c.poste})` : role === "SM" ? " (SM)" : "") + (followUp === "gap" ? " *⚠*" : followUp === "referent" ? " `⚠`" : ""),
        shape: "dot",
        size,
        color: {
          background: displayColor,
          border: isFragile ? cssVar("--ring-fragile") : displayColor,
          highlight: { background: roleColor, border: isFragile ? cssVar("--ring-fragile") : cssVar("--text-primary") },
        },
        font: {
          color: isContextual ? cssVar("--text-muted") : cssVar("--text-primary"),
          size: 13,
          multi: "md",
          bold: { color: cssVar("--gap-warning"), size: 18, mod: "bold" },
          // Alerte jaune (suivi uniquement par un consultant référent) : groupe "mono" de vis-network,
          // seul autre style de police coloré disponible dans le balisage markdown.
          mono: { color: cssVar("--status-warning"), size: 18, face: "arial", mod: "bold" },
        },
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
        if (c.consultant_referent_id && collabIds.has(c.consultant_referent_id) && !contextualIds.has(c.consultant_referent_id)) {
          edges.push({
            id: "cr:" + c.consultant_referent_id + ">" + c.id,
            from: "c:" + c.consultant_referent_id,
            to: "c:" + c.id,
            arrows: "to",
            dashes: [8, 3, 2, 3],
            color: { color: cssVar("--edge-referent") },
            width: 1.5,
            _kind: "referent",
          });
        }
      }
    }

    // Les réunions n'ont plus de nœud dédié :
    // - Individuelle : un simple trait entre les 2 personnes reliées (animateur <-> collaborateur).
    // - Équipe : une forme organique dessinée autour de ses membres (dans la forme =
    //   dans la réunion), recalculée à chaque frame pour suivre les nœuds (cf. drawTeamMeetingCircles).
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
            color: { color: colorByPeriodicite ? periodiciteColor(p.periodicite) : cssVar("--edge-anim") },
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
    selectedIds = new Set();
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
      const srcEvent = params.event && params.event.srcEvent;
      const isMulti = !!(srcEvent && (srcEvent.ctrlKey || srcEvent.metaKey || srcEvent.shiftKey));

      if (params.nodes.length) {
        const nodeId = params.nodes[0];
        if (isMulti) {
          // Un pin simple en cours devient le premier élément de la sélection multiple :
          // Ctrl/Maj+clic sur un 2e nœud construit naturellement un groupe de 2.
          if (pinnedId && !pinnedId.startsWith("circle:")) selectedIds.add(pinnedId);
          pinnedId = null;
          if (selectedIds.has(nodeId)) selectedIds.delete(nodeId);
          else selectedIds.add(nodeId);
          if (selectedIds.size) highlightSelection();
          else clearHighlight();
          return;
        }
        selectedIds = new Set();
        pinnedId = nodeId;
        onHoverNode(pinnedId);
        const connected = network.getConnectedNodes(pinnedId);
        network.fit({ nodes: [pinnedId, ...connected], animation: { duration: 400 } });
        return;
      }
      if (isMulti) return; // Ctrl/Maj+clic sur le vide : ne modifie pas la sélection en cours
      selectedIds = new Set();
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
    const baseColor = cssVar("--edge-anim");
    const textColor = cssVar("--text-primary");
    teamMeetingCircles.forEach((tm) => {
      const positions = network.getPositions(tm.memberIds);
      const pts = tm.memberIds.map((id) => positions[id]).filter(Boolean);
      if (!pts.length) return;
      const poly = paddedBlobPolygon(pts, HULL_PADDING);
      tm.poly = poly;
      const cx = pts.reduce((s, pt) => s + pt.x, 0) / pts.length;
      const cy = pts.reduce((s, pt) => s + pt.y, 0) / pts.length;

      const color = colorByPeriodicite ? periodiciteColor(tm.point.periodicite) : baseColor;
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

  // Sélection multiple (Ctrl/Maj+clic) : chaque nœud sélectionné garde sa propre
  // "surbrillance" (lui + ses connexions), comme un clic simple mais cumulé.
  function highlightSelection() {
    const nodeIds = new Set(selectedIds);
    const edgeIds = new Set();
    selectedIds.forEach((id) => {
      network.getConnectedNodes(id).forEach((n) => nodeIds.add(n));
      network.getConnectedEdges(id).forEach((e) => edgeIds.add(e));
    });
    highlight([...nodeIds], [...edgeIds]);
    hideTooltip();
  }

  function restorePinnedOrClear() {
    if (!pinnedId) {
      if (selectedIds.size) {
        highlightSelection();
        return;
      }
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
    const nbGap = collabs.filter((c) => followUpStatus(c) === "gap").length;
    const nbReferent = collabs.filter((c) => followUpStatus(c) === "referent").length;
    els.stats.textContent =
      `${collabs.length} collaborateur(s) · ${points.length} réunion(s)` +
      (nbGap ? ` · ⚠ ${nbGap} sans réunion commune avec un responsable` : "") +
      (nbReferent ? ` · ⚠ ${nbReferent} suivi(s) uniquement par un consultant référent` : "");
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
      <div class="tt-sub">${p.type} · ${p.periodicite}</div>
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
    const ref = c.consultant_referent_id ? findCollab(c.consultant_referent_id) : null;
    const followUp = followUpStatus(c);
    const referentOf = encadresPar(c.id, "consultant_referent_id");
    const pts = pointsForCollab(c.id);
    const smOf = encadresPar(c.id, "senior_manager_id");
    const mgrOf = encadresPar(c.id, "manager_id");
    const cpOf = encadresPar(c.id, "chef_de_projet_id");
    showTooltip(`
      <div class="tt-title">${collabName(c)}</div>
      <div class="tt-sub">${c.poste || "Poste non précisé"}</div>
      ${node._contextual ? `<div class="tt-row" style="color:var(--text-muted)">Hors du filtre actuel — affiché car présent dans une réunion filtrée</div>` : ""}
      <div class="tt-row"><span class="tt-label">Senior Manager :</span> ${sm ? collabName(sm) : c.senior_manager_id || "— (SM de tête)"}</div>
      ${mgr ? `<div class="tt-row"><span class="tt-label">Manager :</span> ${collabName(mgr)}</div>` : c.manager_id ? `<div class="tt-row"><span class="tt-label">Manager :</span> ${c.manager_id}</div>` : ""}
      ${cp ? `<div class="tt-row"><span class="tt-label">Chef de projet :</span> ${collabName(cp)}</div>` : c.chef_de_projet_id ? `<div class="tt-row"><span class="tt-label">Chef de projet :</span> ${c.chef_de_projet_id}</div>` : ""}
      ${ref ? `<div class="tt-row"><span class="tt-label">Consultant référent :</span> ${collabName(ref)}</div>` : c.consultant_referent_id ? `<div class="tt-row"><span class="tt-label">Consultant référent :</span> ${c.consultant_referent_id}</div>` : ""}
      ${c.compte_reference ? `<div class="tt-row"><span class="tt-label">Compte de référence :</span> ${c.compte_reference}</div>` : ""}
      ${tagPillsHtml(c.tags)}
      ${smOf.length ? `<div class="tt-row" style="margin-top:8px"><span class="tt-label">SM de :</span> ${smOf.join(", ")}</div>` : ""}
      ${mgrOf.length ? `<div class="tt-row"><span class="tt-label">Manager de :</span> ${mgrOf.join(", ")}</div>` : ""}
      ${cpOf.length ? `<div class="tt-row"><span class="tt-label">CP de :</span> ${cpOf.join(", ")}</div>` : ""}
      ${referentOf.length ? `<div class="tt-row"><span class="tt-label">Consultant référent de :</span> ${referentOf.join(", ")}</div>` : ""}
      ${pts.length ? `<div class="tt-row" style="margin-top:8px"><span class="tt-label">Réunions :</span><ul class="tt-list">${pts.map((x) => `<li>${x.point.nom || "Réunion individuelle"} — ${x.role} (${x.point.periodicite})</li>`).join("")}</ul></div>` : ""}
      ${followUp === "gap" ? `<div class="tt-row" style="margin-top:8px;color:var(--gap-warning)">⚠ Aucune réunion commune avec un responsable (SM/Manager/CP)</div>` : ""}
      ${followUp === "referent" ? `<div class="tt-row" style="margin-top:8px;color:var(--status-warning)">⚠ Réunion commune uniquement avec son consultant référent (aucune avec SM/Manager/CP)</div>` : ""}
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
    if (document.body.classList.contains("view-carte")) return; // la recherche est gérée par carte.js
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
  // API minimale pour carte.js : lecture seule de l'état déjà fusionné et des filtres.
  window.CartoApp = {
    getCollabs: () => state.collaborateurs,
    getFilters: () => ({ compte: els.filterCompte.value, sm: els.filterSmViz.value }),
    getStatsText: () => els.stats.textContent,
    setStatsText: (t) => (els.stats.textContent = t),
    collabName,
    roleOf,
    roleColorVar,
    cssVar,
    tagPillsHtml,
  };
})();
