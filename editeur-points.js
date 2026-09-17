(function () {
  "use strict";

  const norm = (v) => (v === undefined || v === null ? "" : String(v).trim());
  const isOui = (v) => norm(v).toLowerCase() === "oui";
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const uid = () => "P" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  // Ordre hiérarchique utilisé pour grouper les listes déroulantes de chefs/animateurs.
  // "Consultant" est le groupe par défaut : un poste vide, mal saisi ou non reconnu y
  // atterrit quand même, pour qu'on ne perde jamais silencieusement quelqu'un de la liste.
  const ROLE_ORDER = ["Senior Manager", "Manager", "Directeur de projet", "Chef de projet", "Consultant"];
  function roleGroupLabel(poste) {
    return ROLE_ORDER.includes(poste) ? poste : "Consultant";
  }

  let collaborateurs = []; // {id, nom, prenom, poste, senior_manager_id}
  let collabPrevById = {}; // id -> senior_manager_id, photo du collaborateurs.xlsx précédent
  let rattachIds = new Set(); // ids déjà présents dans rattachements.xlsx chargé (recap "nouveaux")
  let points = []; // {id, nom, animateur_id, participants: Set<id>, type, periodicite, ordre_du_jour, actif}
  let editingId = null;
  let lastAnimateurId = ""; // repris par défaut pour la prochaine réunion ajoutée
  let perimeter = ""; // id d'un SM, "__non_assigne__", ou "" (tous)

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
    btnBack: document.getElementById("btn-back"),
    stepUpload: document.getElementById("step-upload"),
    stepEdit: document.getElementById("step-edit"),
    perimeterWrap: document.getElementById("perimeter-wrap"),
    filterSm: document.getElementById("filter-sm"),
    recapPanel: document.getElementById("recap-panel"),
    recapContent: document.getElementById("recap-content"),
    formTitle: document.getElementById("form-title"),
    fType: document.getElementById("f-type"),
    fPeriodicite: document.getElementById("f-periodicite"),
    individuelFields: document.getElementById("individuel-fields"),
    groupeFields: document.getElementById("groupe-fields"),
    fChef: document.getElementById("f-chef"),
    fCollaborateur: document.getElementById("f-collaborateur"),
    fAnimateur: document.getElementById("f-animateur"),
    fParticipantsSearch: document.getElementById("f-participants-search"),
    fParticipants: document.getElementById("f-participants"),
    fNom: document.getElementById("f-nom"),
    fOdj: document.getElementById("f-odj"),
    fActif: document.getElementById("f-actif"),
    btnAdd: document.getElementById("btn-add"),
    btnCancelEdit: document.getElementById("btn-cancel-edit"),
    btnDownload: document.getElementById("btn-download"),
    tableBody: document.getElementById("table-body"),
    countPoints: document.getElementById("count-points"),
    uncoveredPanel: document.getElementById("uncovered-panel"),
    uncoveredList: document.getElementById("uncovered-list"),
    countUncovered: document.getElementById("count-uncovered"),
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

  function sheetRows(wb, name) {
    const sheet = wb.Sheets[name];
    if (!sheet) return [];
    return XLSX.utils.sheet_to_json(sheet, { defval: "" });
  }

  function collabName(c) {
    return [c.prenom, c.nom].filter(Boolean).join(" ") || c.id;
  }
  function findCollab(id) {
    return collaborateurs.find((c) => c.id === id);
  }

  function updateContinueState() {
    els.btnContinue.disabled = collaborateurs.length === 0;
  }

  function rowsToCollabPrevMap(rows) {
    const map = {};
    (rows || []).filter((r) => norm(r.id)).forEach((r) => {
      map[norm(r.id)] = norm(r.senior_manager_id);
    });
    return map;
  }

  // ---------- Étape 1 : Collaborateurs (obligatoire) ----------
  function applyCollabRows(rows, label) {
    collaborateurs = rows
      .filter((r) => norm(r.id))
      .map((r) => ({
        id: norm(r.id),
        nom: norm(r.nom),
        prenom: norm(r.prenom),
        poste: norm(r.poste),
        senior_manager_id: norm(r.senior_manager_id),
      }))
      .sort((a, b) => collabName(a).localeCompare(collabName(b)));
    els.dzCollab.style.display = "none";
    els.loadedCollab.style.display = "flex";
    els.loadedCollabName.textContent = `${label} (${collaborateurs.length} collaborateur(s))`;
    populateSelects();
    updateContinueState();
  }

  wireDropzone(els.dzCollab, els.fileCollab, async (file) => {
    try {
      const wb = await readWorkbook(file);
      const rows = sheetRows(wb, "Collaborateurs");
      CartoState.save("collab", rows);
      collabPrevById = rowsToCollabPrevMap(CartoState.load("collabPrev"));
      applyCollabRows(rows, file.name);
    } catch (err) {
      alert("Impossible de lire ce fichier : " + err.message);
    }
  });

  els.btnChangeCollab.addEventListener("click", () => {
    collaborateurs = [];
    // On ne vide pas la session ici : elle doit rester intacte jusqu'au prochain
    // upload, pour que celui-ci puisse correctement basculer l'ancienne valeur en
    // "collabPrev" (nécessaire à la détection des départs).
    els.fileCollab.value = "";
    els.dzCollab.style.display = "block";
    els.loadedCollab.style.display = "none";
    updateContinueState();
  });

  // ---------- Étape 2 : Rattachements (facultatif, pour le récap nouveaux/disparus) ----------
  function applyRattachRows(rows, label) {
    rattachIds = new Set(rows.map((r) => norm(r.id)).filter(Boolean));
    els.rattachChoice.style.display = "none";
    els.loadedRattach.style.display = "flex";
    els.loadedRattachName.textContent = `${label} (${rows.length} ligne(s))`;
  }

  wireDropzone(els.dzRattach, els.fileRattach, async (file) => {
    try {
      const wb = await readWorkbook(file);
      const rows = sheetRows(wb, "Rattachements");
      CartoState.save("rattach", rows);
      applyRattachRows(rows, file.name);
    } catch (err) {
      alert("Impossible de lire ce fichier : " + err.message);
    }
  });
  els.btnSkipRattach.addEventListener("click", () => {
    rattachIds = new Set();
    CartoState.clear("rattach");
    els.rattachChoice.style.display = "none";
    els.loadedRattach.style.display = "flex";
    els.loadedRattachName.textContent = "Ignoré";
  });
  els.btnChangeRattach.addEventListener("click", () => {
    rattachIds = new Set();
    CartoState.clear("rattach");
    els.fileRattach.value = "";
    els.rattachChoice.style.display = "block";
    els.loadedRattach.style.display = "none";
  });

  // ---------- Étape 3 : Réunions existantes (facultatif) ----------
  function applyPointRows(rows, label) {
    points = rows
      .filter((r) => norm(r.id))
      .map((r) => ({
        id: norm(r.id),
        nom: norm(r.nom),
        animateur_id: norm(r.animateur_id),
        participants: new Set(
          norm(r.participants_ids).split(",").map((s) => s.trim()).filter(Boolean)
        ),
        type: norm(r.type) || "Individuel",
        periodicite: norm(r.periodicite) || "Hebdomadaire",
        ordre_du_jour: norm(r.ordre_du_jour),
        actif: !norm(r.actif) || isOui(r.actif),
      }));
    els.pointsChoice.style.display = "none";
    els.loadedPoints.style.display = "flex";
    els.loadedPointsName.textContent = `${label} (${points.length} réunion(s))`;
  }

  wireDropzone(els.dzPoints, els.filePoints, async (file) => {
    try {
      const wb = await readWorkbook(file);
      const rows = sheetRows(wb, "Réunions");
      CartoState.save("points", rows);
      applyPointRows(rows, file.name);
    } catch (err) {
      alert("Impossible de lire ce fichier : " + err.message);
    }
  });

  els.btnSkipPoints.addEventListener("click", () => {
    points = [];
    CartoState.clear("points");
    els.pointsChoice.style.display = "none";
    els.loadedPoints.style.display = "flex";
    els.loadedPointsName.textContent = "Ignoré";
  });

  els.btnChangePoints.addEventListener("click", () => {
    points = [];
    CartoState.clear("points");
    els.filePoints.value = "";
    els.pointsChoice.style.display = "block";
    els.loadedPoints.style.display = "none";
  });

  // ---------- Restauration depuis la session (changement d'onglet sans réupload) ----------
  (function hydrateFromSession() {
    collabPrevById = rowsToCollabPrevMap(CartoState.load("collabPrev"));
    const savedCollab = CartoState.load("collab");
    if (savedCollab && savedCollab.length) applyCollabRows(savedCollab, "Session précédente");
    const savedRattach = CartoState.load("rattach");
    if (savedRattach && savedRattach.length) applyRattachRows(savedRattach, "Session précédente");
    const savedPoints = CartoState.load("points");
    if (savedPoints && savedPoints.length) applyPointRows(savedPoints, "Session précédente");
  })();

  els.btnContinue.addEventListener("click", () => {
    els.stepUpload.style.display = "none";
    els.stepEdit.style.display = "block";
    populatePerimeterFilter();
    resetForm();
    render();
  });
  els.btnBack.addEventListener("click", () => {
    els.stepEdit.style.display = "none";
    els.stepUpload.style.display = "block";
  });

  // ---------- Filtre de périmètre (disponible dès collaborateurs.xlsx, qui porte
  // désormais senior_manager_id directement) ----------
  function populatePerimeterFilter() {
    const sms = collaborateurs
      .filter((c) => c.poste === "Senior Manager")
      .sort((a, b) => collabName(a).localeCompare(collabName(b)));
    els.perimeterWrap.style.display = sms.length ? "block" : "none";
    if (!sms.length) {
      perimeter = "";
      return;
    }
    els.filterSm.innerHTML =
      `<option value="">Tous les périmètres</option>` +
      `<option value="__non_assigne__">Non assignés (aucun SM renseigné)</option>` +
      sms.map((c) => `<option value="${c.id}">Périmètre de ${collabName(c)}</option>`).join("");
    els.filterSm.value = perimeter;
  }
  els.filterSm.addEventListener("change", () => {
    perimeter = els.filterSm.value;
    populateSelects();
    render();
  });

  function matchesPerimeter(c) {
    if (!perimeter) return true;
    if (perimeter === "__non_assigne__") return !c.senior_manager_id;
    return c.id === perimeter || c.senior_manager_id === perimeter;
  }
  function visibleCollaborateurs() {
    return collaborateurs.filter(matchesPerimeter);
  }

  // Écarts pour le périmètre sélectionné (rattachements OU réunions) :
  // - Nouveaux : rattachés à ce SM dans collaborateurs.xlsx, mais jamais vus ni dans
  //   rattachements.xlsx ni dans reunions.xlsx chargés.
  // - Disparus : étaient rattachés à ce SM dans le PRÉCÉDENT collaborateurs.xlsx, mais
  //   ne le sont plus (parti du référentiel, ou réaffecté à un autre SM).
  function computeRecap(smId) {
    const involvedInPoints = new Set();
    points.forEach((p) => {
      if (p.animateur_id) involvedInPoints.add(p.animateur_id);
      p.participants.forEach((id) => involvedInPoints.add(id));
    });

    const currentIds = new Set(
      collaborateurs.filter((c) => c.id !== smId && c.senior_manager_id === smId).map((c) => c.id)
    );
    const nouveaux = [...currentIds]
      .filter((id) => !rattachIds.has(id) && !involvedInPoints.has(id))
      .map((id) => collabName(findCollab(id)));

    const prevIds = new Set(
      Object.keys(collabPrevById).filter((id) => id !== smId && collabPrevById[id] === smId)
    );
    const disparus = [...prevIds]
      .filter((id) => !currentIds.has(id))
      .map((id) => {
        const c = findCollab(id);
        return c ? `${collabName(c)} (plus rattaché à ce SM)` : `${id} (absent de collaborateurs.xlsx)`;
      });

    return { nouveaux, disparus };
  }

  function renderRecap() {
    const smFilter = perimeter;
    const showRecap = smFilter && smFilter !== "__non_assigne__";
    els.recapPanel.style.display = showRecap ? "block" : "none";
    if (!showRecap) return;
    const { nouveaux, disparus } = computeRecap(smFilter);
    if (!nouveaux.length && !disparus.length) {
      els.recapContent.innerHTML = `<div class="muted-note">Aucun écart détecté pour ce périmètre.</div>`;
      return;
    }
    els.recapContent.innerHTML = `
      ${nouveaux.length ? `<div class="tt-row"><span class="tt-label">Nouveaux, jamais vus dans rattachements/reunions (${nouveaux.length}) :</span> ${nouveaux.join(", ")}</div>` : ""}
      ${disparus.length ? `<div class="tt-row" style="margin-top:6px"><span class="tt-label">Ne sont plus rattachés à ce SM (${disparus.length}) :</span> ${disparus.join(", ")}</div>` : ""}
    `;
  }

  // Aide à la saisie : qui n'apparaît encore dans aucune réunion active (ni comme
  // animateur, ni comme participant) — pour repérer ce qu'il reste à couvrir.
  // Respecte le filtre de périmètre courant, comme le reste du formulaire.
  function uncoveredCollaborateurs() {
    const covered = new Set();
    points
      .filter((p) => p.actif)
      .forEach((p) => {
        if (p.animateur_id) covered.add(p.animateur_id);
        p.participants.forEach((id) => covered.add(id));
      });
    return visibleCollaborateurs()
      .filter((c) => !covered.has(c.id))
      .sort((a, b) => collabName(a).localeCompare(collabName(b)));
  }

  function renderUncovered() {
    const list = uncoveredCollaborateurs();
    els.countUncovered.textContent = list.length;
    els.uncoveredList.innerHTML =
      list
        .map((c) => `<button type="button" class="chip" data-id="${c.id}">${collabName(c)}</button>`)
        .join("") || `<div class="muted-note">Tout le monde est couvert 🎉</div>`;
    els.uncoveredList.querySelectorAll(".chip").forEach((chip) =>
      chip.addEventListener("click", () => {
        if (editingId) return; // ne perturbe pas une modification en cours
        els.fType.value = "Individuel";
        applyTypeVisibility();
        els.fChef.value = lastAnimateurId;
        els.fCollaborateur.value = chip.dataset.id;
        els.fCollaborateur.dispatchEvent(new Event("change", { bubbles: true }));
        els.fCollaborateur.scrollIntoView({ behavior: "smooth", block: "center" });
      })
    );
  }

  function populateGroupedSelect(selectEl, list, opts) {
    opts = opts || {};
    const previous = selectEl.value;
    let html = '<option value="">—</option>';
    if (opts.includeAutre) html += '<option value="Autre">Autre</option>';
    ROLE_ORDER.forEach((label) => {
      const items = list
        .filter((c) => roleGroupLabel(c.poste) === label)
        .sort((a, b) => collabName(a).localeCompare(collabName(b)));
      if (!items.length) return;
      html += `<optgroup label="${label}">${items.map((c) => `<option value="${c.id}">${collabName(c)}</option>`).join("")}</optgroup>`;
    });
    selectEl.innerHTML = html;
    if ([...selectEl.options].some((o) => o.value === previous)) selectEl.value = previous;
  }

  function populateSelects() {
    const visible = visibleCollaborateurs();
    populateGroupedSelect(els.fChef, visible, { includeAutre: true });
    populateGroupedSelect(els.fAnimateur, visible, { includeAutre: true });
    populateGroupedSelect(els.fCollaborateur, visible, {});
    renderParticipantsList();
  }

  function renderParticipantsList(filter, checkedIds) {
    filter = norm(filter).toLowerCase();
    const checked = checkedIds || new Set();
    const list = visibleCollaborateurs().filter((c) => !filter || collabName(c).toLowerCase().includes(filter));
    els.fParticipants.innerHTML =
      list
        .map(
          (c) => `
      <label class="check-item">
        <input type="checkbox" value="${c.id}" ${checked.has(c.id) ? "checked" : ""}>
        ${collabName(c)}
      </label>`
        )
        .join("") || `<div class="muted-note">Aucun résultat</div>`;
  }

  els.fParticipantsSearch.addEventListener("input", () => {
    const checked = new Set([...els.fParticipants.querySelectorAll("input:checked")].map((i) => i.value));
    renderParticipantsList(els.fParticipantsSearch.value, checked);
  });

  function applyTypeVisibility() {
    const isIndividuel = els.fType.value === "Individuel";
    els.individuelFields.style.display = isIndividuel ? "block" : "none";
    els.groupeFields.style.display = isIndividuel ? "none" : "block";
  }
  els.fType.addEventListener("change", applyTypeVisibility);

  // Présaisie automatique du nom pour une réunion individuelle : "Réunion individuelle <Collaborateur>".
  // Ne se déclenche que sur une vraie interaction utilisateur (pas lors du chargement d'une
  // réunion existante), pour ne jamais écraser un nom personnalisé au rechargement. Le nom
  // reste modifiable ou même effaçable : ce n'est qu'une suggestion, pas une obligation.
  els.fCollaborateur.addEventListener("change", () => {
    const c = findCollab(els.fCollaborateur.value);
    if (c) els.fNom.value = "Réunion individuelle " + collabName(c);
  });

  function resetForm() {
    editingId = null;
    els.formTitle.textContent = "Ajouter une réunion";
    els.btnAdd.textContent = "Ajouter la réunion";
    els.btnCancelEdit.style.display = "none";
    els.fType.value = "Individuel";
    els.fPeriodicite.value = "Hebdomadaire";
    els.fChef.value = lastAnimateurId;
    els.fCollaborateur.value = "";
    els.fAnimateur.value = lastAnimateurId;
    els.fNom.value = "";
    els.fOdj.value = "";
    els.fActif.checked = true;
    els.fParticipantsSearch.value = "";
    renderParticipantsList();
    applyTypeVisibility();
  }

  function loadIntoForm(point) {
    editingId = point.id;
    els.formTitle.textContent = "Modifier la réunion";
    els.btnAdd.textContent = "Enregistrer les modifications";
    els.btnCancelEdit.style.display = "inline-flex";
    els.fType.value = point.type;
    els.fPeriodicite.value = point.periodicite;
    els.fNom.value = point.nom;
    els.fOdj.value = point.ordre_du_jour;
    els.fActif.checked = point.actif;
    els.fParticipantsSearch.value = "";
    if (point.type === "Individuel") {
      els.fChef.value = point.animateur_id;
      els.fCollaborateur.value = [...point.participants][0] || "";
    } else {
      els.fAnimateur.value = point.animateur_id;
      renderParticipantsList("", point.participants);
    }
    applyTypeVisibility();
  }

  els.btnCancelEdit.addEventListener("click", resetForm);

  els.btnAdd.addEventListener("click", () => {
    const type = els.fType.value;
    let animateur_id, participants, nom;

    if (type === "Individuel") {
      animateur_id = els.fChef.value;
      const collabId = els.fCollaborateur.value;
      participants = new Set(collabId ? [collabId] : []);
      nom = norm(els.fNom.value);
      if (!animateur_id || !collabId) {
        alert("Choisis un animateur et un collaborateur pour une réunion individuelle.");
        return;
      }
    } else {
      animateur_id = els.fAnimateur.value;
      participants = new Set([...els.fParticipants.querySelectorAll("input:checked")].map((i) => i.value));
      nom = norm(els.fNom.value);
    }

    const data = {
      id: editingId || uid(),
      nom,
      animateur_id,
      participants,
      type,
      periodicite: els.fPeriodicite.value,
      ordre_du_jour: norm(els.fOdj.value),
      actif: els.fActif.checked,
    };
    lastAnimateurId = animateur_id || lastAnimateurId;
    if (editingId) {
      const idx = points.findIndex((p) => p.id === editingId);
      points[idx] = data;
    } else {
      points.push(data);
    }
    resetForm();
    render();
  });

  function animateurLabel(id) {
    if (!id) return "—";
    const c = findCollab(id);
    return c ? collabName(c) : id;
  }

  function render() {
    renderRecap();
    renderUncovered();
    els.countPoints.textContent = points.length;
    els.tableBody.innerHTML = points
      .map(
        (p) => `
        <tr>
          <td>${p.nom || "(Sans nom)"}</td>
          <td>${p.type}</td>
          <td>${p.periodicite}</td>
          <td>${animateurLabel(p.animateur_id)}</td>
          <td>${p.participants.size}</td>
          <td>${p.actif ? "Oui" : "Non"}</td>
          <td>
            <button class="btn btn-secondary btn-small" data-action="edit" data-id="${p.id}">Modifier</button>
            <button class="btn btn-danger btn-small" data-action="delete" data-id="${p.id}">Supprimer</button>
          </td>
        </tr>`
      )
      .join("");

    els.tableBody.querySelectorAll('[data-action="edit"]').forEach((btn) =>
      btn.addEventListener("click", () => loadIntoForm(points.find((p) => p.id === btn.dataset.id)))
    );
    els.tableBody.querySelectorAll('[data-action="delete"]').forEach((btn) =>
      btn.addEventListener("click", () => {
        if (confirm("Supprimer cette réunion ?")) {
          points = points.filter((p) => p.id !== btn.dataset.id);
          render();
        }
      })
    );
  }

  els.btnDownload.addEventListener("click", () => {
    const today = todayISO();
    const rows = [
      ["id", "nom", "animateur_id", "participants_ids", "type", "periodicite", "ordre_du_jour", "actif", "date_maj"],
    ];
    points.forEach((p) => {
      rows.push([
        p.id, p.nom, p.animateur_id, [...p.participants].join(","),
        p.type, p.periodicite, p.ordre_du_jour, p.actif ? "Oui" : "Non", today,
      ]);
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Réunions");
    CartoState.save("points", XLSX.utils.sheet_to_json(ws, { defval: "" }));
    XLSX.writeFile(wb, "reunions.xlsx");
  });

  applyTypeVisibility();
})();
