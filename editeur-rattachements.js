(function () {
  "use strict";

  const norm = (v) => (v === undefined || v === null ? "" : String(v).trim());
  const isOui = (v) => norm(v).toLowerCase() === "oui";
  const todayISO = () => new Date().toISOString().slice(0, 10);

  const posteColorVar = (poste) => {
    if (poste === "Senior Manager") return "--node-person-sm";
    if (poste === "Manager") return "--node-person-manager";
    if (poste === "Chef de projet" || poste === "Directeur de projet") return "--node-person-cp";
    return "--node-person";
  };
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  let collaborateurs = []; // {id, nom, prenom, poste, senior_manager_id}
  let collabPrevById = {}; // id -> senior_manager_id, photo du collaborateurs.xlsx précédent
  let rattach = {}; // id -> {manager_id, chef_de_projet_id, compte_reference, tag_*}
  let rattachLoaded = false;
  // Photo figée de rattachements.xlsx au moment du chargement (jamais modifiée ensuite) :
  // sert à repérer les collaborateurs jamais encore traités (nouveaux) et à trier la table.
  let rattachSnapshot = {};

  const els = {
    fileCollab: document.getElementById("file-collab"),
    fileRattach: document.getElementById("file-rattach"),
    dzCollab: document.getElementById("dz-collab"),
    dzRattach: document.getElementById("dz-rattach"),
    stepCollab: document.getElementById("step-collab"),
    stepRattach: document.getElementById("step-rattach"),
    loadedCollab: document.getElementById("loaded-collab"),
    loadedCollabName: document.getElementById("loaded-collab-name"),
    btnChangeCollab: document.getElementById("btn-change-collab"),
    rattachChoice: document.getElementById("rattach-choice"),
    loadedRattach: document.getElementById("loaded-rattach"),
    loadedRattachName: document.getElementById("loaded-rattach-name"),
    btnChangeRattach: document.getElementById("btn-change-rattach"),
    btnSkipRattach: document.getElementById("btn-skip-rattach"),
    btnContinue: document.getElementById("btn-continue"),
    btnBack: document.getElementById("btn-back"),
    stepUpload: document.getElementById("step-upload"),
    stepEdit: document.getElementById("step-edit"),
    tableBody: document.getElementById("table-body"),
    search: document.getElementById("search"),
    filterSm: document.getElementById("filter-sm"),
    btnDownload: document.getElementById("btn-download"),
    recapPanel: document.getElementById("recap-panel"),
    recapContent: document.getElementById("recap-content"),
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

  function applyCollabRows(rows, label) {
    collaborateurs = rows
      .filter((r) => norm(r.id))
      .map((r) => ({
        id: norm(r.id),
        nom: norm(r.nom),
        prenom: norm(r.prenom),
        poste: norm(r.poste),
        senior_manager_id: norm(r.senior_manager_id),
      }));
    els.dzCollab.style.display = "none";
    els.loadedCollab.style.display = "flex";
    els.loadedCollabName.textContent = `${label} (${collaborateurs.length} collaborateur(s))`;
    updateContinueState();
  }

  wireDropzone(els.dzCollab, els.fileCollab, async (file) => {
    try {
      const wb = await readWorkbook(file);
      const rows = CartoXlsx.readCollaborateurs(wb);
      // La version qu'on est en train de remplacer devient la photo "précédente"
      // (via CartoState.save, qui fait la rotation), utilisée pour détecter les départs.
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

  function applyRattachRows(rows, label) {
    rattach = {};
    rows.filter((r) => norm(r.id)).forEach((r) => {
      rattach[norm(r.id)] = {
        manager_id: norm(r.manager_id),
        chef_de_projet_id: norm(r.chef_de_projet_id),
        compte_reference: norm(r.compte_reference),
        adresse_mission: norm(r.adresse_mission),
        lat: norm(r.lat),
        lon: norm(r.lon),
        tag_haut_potentiel: isOui(r.tag_haut_potentiel),
        tag_en_fragilite: isOui(r.tag_en_fragilite),
        tag_consultant_isole: isOui(r.tag_consultant_isole),
      };
    });
    rattachSnapshot = JSON.parse(JSON.stringify(rattach));
    rattachLoaded = true;
    els.rattachChoice.style.display = "none";
    els.loadedRattach.style.display = "flex";
    els.loadedRattachName.textContent = `${label} (${rows.length} rattachement(s))`;
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
    rattach = {};
    rattachSnapshot = {};
    rattachLoaded = false;
    CartoState.clear("rattach");
    els.rattachChoice.style.display = "none";
    els.loadedRattach.style.display = "flex";
    els.loadedRattachName.textContent = "Ignoré";
  });

  els.btnChangeRattach.addEventListener("click", () => {
    rattach = {};
    rattachSnapshot = {};
    rattachLoaded = false;
    CartoState.clear("rattach");
    els.fileRattach.value = "";
    els.rattachChoice.style.display = "block";
    els.loadedRattach.style.display = "none";
  });

  // Restauration depuis la session (changement d'onglet sans réupload).
  (function hydrateFromSession() {
    collabPrevById = rowsToCollabPrevMap(CartoState.load("collabPrev"));
    const savedCollab = CartoState.load("collab");
    if (savedCollab && savedCollab.length) applyCollabRows(savedCollab, "Session précédente");
    const savedRattach = CartoState.load("rattach");
    if (savedRattach && savedRattach.length) applyRattachRows(savedRattach, "Session précédente");
  })();

  els.btnContinue.addEventListener("click", () => {
    els.stepUpload.style.display = "none";
    els.stepEdit.style.display = "block";
    populateSmFilter();
    render();
  });

  // Liste des Senior Managers présents dans collaborateurs.xlsx, pour filtrer la table
  // sur le périmètre d'un seul SM (utile quand l'UO compte plusieurs SM et que chacun
  // ne veut voir/traiter que ses propres collaborateurs). Disponible dès que
  // collaborateurs.xlsx est chargé, puisque senior_manager_id y vit directement.
  function populateSmFilter() {
    const sms = collaborateurs
      .filter((c) => c.poste === "Senior Manager")
      .sort((a, b) => collabName(a).localeCompare(collabName(b)));
    els.filterSm.innerHTML =
      `<option value="">Tous les périmètres</option>` +
      `<option value="__non_assigne__">Non assignés (aucun SM renseigné)</option>` +
      sms.map((c) => `<option value="${c.id}">Périmètre de ${collabName(c)}</option>`).join("");
  }
  els.btnBack.addEventListener("click", () => {
    els.stepEdit.style.display = "none";
    els.stepUpload.style.display = "block";
  });

  function getRattach(id) {
    if (!rattach[id]) {
      rattach[id] = {
        manager_id: "",
        chef_de_projet_id: "",
        compte_reference: "",
        adresse_mission: "",
        lat: "",
        lon: "",
        tag_haut_potentiel: false,
        tag_en_fragilite: false,
        tag_consultant_isole: false,
      };
    }
    return rattach[id];
  }

  function collabName(c) {
    return [c.prenom, c.nom].filter(Boolean).join(" ") || c.id;
  }
  function findCollabById(id) {
    return collaborateurs.find((c) => c.id === id);
  }

  function optionsFor(poste, sentinel) {
    const list = collaborateurs.filter((c) => {
      if (poste === "cp_dp") return c.poste === "Chef de projet" || c.poste === "Directeur de projet";
      return c.poste === poste;
    });
    let html = `<option value="">—</option><option value="${sentinel}">${sentinel}</option>`;
    list
      .slice()
      .sort((a, b) => collabName(a).localeCompare(collabName(b)))
      .forEach((c) => {
        html += `<option value="${c.id}">${collabName(c)} (${c.id})</option>`;
      });
    return html;
  }

  // Un collaborateur est "nouveau" s'il n'a aucune ligne dans rattachements.xlsx chargé —
  // mis en avant en tête de liste pour qu'on pense à le renseigner.
  function isNewSinceSnapshot(id) {
    return rattachLoaded && !(id in rattachSnapshot);
  }

  // Écarts pour le périmètre sélectionné :
  // - Nouveaux : rattachés à ce SM dans collaborateurs.xlsx, mais jamais vus dans
  //   rattachements.xlsx (aucune ligne du tout) — calculable dès le chargement, sans
  //   attendre une saisie, puisque senior_manager_id vient directement de collaborateurs.xlsx.
  // - Disparus : étaient rattachés à ce SM dans le PRÉCÉDENT collaborateurs.xlsx chargé,
  //   mais ne le sont plus (parti du référentiel, ou réaffecté à un autre SM).
  function computeRecap(smId) {
    const currentIds = new Set(
      collaborateurs.filter((c) => c.id !== smId && c.senior_manager_id === smId).map((c) => c.id)
    );
    const nouveaux = [...currentIds]
      .filter((id) => !(id in rattachSnapshot))
      .map((id) => collabName(findCollabById(id)));

    const prevIds = new Set(
      Object.keys(collabPrevById).filter((id) => id !== smId && collabPrevById[id] === smId)
    );
    const disparus = [...prevIds]
      .filter((id) => !currentIds.has(id))
      .map((id) => {
        const c = findCollabById(id);
        return c ? `${collabName(c)} (plus rattaché à ce SM)` : `${id} (absent de collaborateurs.xlsx)`;
      });

    return { nouveaux, disparus };
  }

  function renderRecap(smFilter) {
    const showRecap = smFilter && smFilter !== "__non_assigne__" && Object.keys(collabPrevById).length + Object.keys(rattachSnapshot).length > 0;
    els.recapPanel.style.display = showRecap ? "block" : "none";
    if (!showRecap) return;
    const { nouveaux, disparus } = computeRecap(smFilter);
    if (!nouveaux.length && !disparus.length) {
      els.recapContent.innerHTML = `<div class="muted-note">Aucun écart détecté pour ce périmètre.</div>`;
      return;
    }
    els.recapContent.innerHTML = `
      ${nouveaux.length ? `<div class="tt-row"><span class="tt-label">Nouveaux, jamais vus dans rattachements.xlsx (${nouveaux.length}) :</span> ${nouveaux.join(", ")}</div>` : ""}
      ${disparus.length ? `<div class="tt-row" style="margin-top:6px"><span class="tt-label">Ne sont plus rattachés à ce SM (${disparus.length}) :</span> ${disparus.join(", ")}</div>` : ""}
    `;
  }

  // --- Adresse de mission : autocomplétion via l'API de géocodage de la Géoplateforme (IGN) ---
  // Gratuite, sans clé. Chaque frappe est envoyée à ce service public : on n'y met que
  // l'adresse du site de mission, jamais le nom de la personne. Les coordonnées choisies
  // sont stockées dans le fichier pour ne pas géocoder à chaque ouverture.
  const GEOCODE_URL = "https://data.geopf.fr/geocodage/search";
  const addrTimers = new Map();
  let addrSeq = 0;

  function escAttr(v) {
    return String(v || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function setAddrStatus(td, r) {
    const st = td.querySelector(".addr-status");
    if (!r.adresse_mission) st.textContent = "";
    else if (r.lat && r.lon) st.textContent = "✓ Localisée";
    else st.textContent = "Choisis une suggestion pour la localiser";
    st.classList.toggle("addr-ok", !!(r.lat && r.lon));
  }

  function onAddressInput(input) {
    const td = input.closest(".addr-cell");
    const id = input.dataset.id;
    const r = getRattach(id);
    // Toute modification manuelle invalide les coordonnées jusqu'au choix d'une suggestion.
    r.adresse_mission = input.value.trim();
    r.lat = "";
    r.lon = "";
    setAddrStatus(td, r);
    const list = td.querySelector(".addr-suggestions");
    clearTimeout(addrTimers.get(id));
    if (input.value.trim().length < 3) {
      list.hidden = true;
      return;
    }
    addrTimers.set(id, setTimeout(() => fetchSuggestions(input.value.trim(), list), 250));
  }

  async function fetchSuggestions(query, list) {
    const seq = ++addrSeq;
    list.dataset.seq = String(seq);
    try {
      // lat/lon : simple biais de pertinence vers Paris, pas un filtre strict.
      const url = `${GEOCODE_URL}?q=${encodeURIComponent(query)}&limit=6&index=address&lat=48.86&lon=2.35`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (list.dataset.seq !== String(seq)) return; // une frappe plus récente a pris le relais
      const feats = (data.features || []).filter((f) => f.geometry && f.geometry.coordinates);
      list.innerHTML = feats.length
        ? feats
            .map(
              (f) =>
                `<li data-label="${escAttr(f.properties.label)}" data-lon="${f.geometry.coordinates[0]}" data-lat="${f.geometry.coordinates[1]}">${escAttr(f.properties.label)}</li>`
            )
            .join("")
        : `<li class="addr-none">Aucune adresse trouvée</li>`;
      list.hidden = false;
    } catch (err) {
      list.innerHTML = `<li class="addr-none">Recherche d'adresse indisponible (${escAttr(err.message)})</li>`;
      list.hidden = false;
    }
  }

  function pickSuggestion(li) {
    if (!li.dataset.label) return;
    const td = li.closest(".addr-cell");
    const input = td.querySelector(".addr-input");
    const r = getRattach(input.dataset.id);
    r.adresse_mission = li.dataset.label;
    r.lat = Number(li.dataset.lat).toFixed(6);
    r.lon = Number(li.dataset.lon).toFixed(6);
    input.value = r.adresse_mission;
    td.querySelector(".addr-suggestions").hidden = true;
    setAddrStatus(td, r);
  }

  function render() {
    const filter = norm(els.search.value).toLowerCase();
    const smFilter = els.filterSm.value;
    const mgrOptions = optionsFor("Manager", "Manager Sectoriel");
    const cpOptions = optionsFor("cp_dp", "CP Sectoriel");

    const matchesPerimeter = (c) => {
      if (!smFilter) return true;
      if (smFilter === "__non_assigne__") return !c.senior_manager_id;
      return c.id === smFilter || c.senior_manager_id === smFilter;
    };

    renderRecap(smFilter);

    const sorted = collaborateurs
      .slice()
      .sort((a, b) => collabName(a).localeCompare(collabName(b)))
      .sort((a, b) => Number(isNewSinceSnapshot(b.id)) - Number(isNewSinceSnapshot(a.id)))
      .filter((c) => !filter || collabName(c).toLowerCase().includes(filter))
      .filter(matchesPerimeter);

    els.tableBody.innerHTML = "";
    sorted.forEach((c) => {
      const r = getRattach(c.id);
      const isSM = c.poste === "Senior Manager";
      const isMgrFamily = c.poste === "Manager" || c.poste === "Chef de projet" || c.poste === "Directeur de projet";
      const hpDisabled = isSM || isMgrFamily;
      const otherTagsDisabled = isSM;
      if (isSM) {
        r.tag_haut_potentiel = false;
        r.tag_en_fragilite = false;
        r.tag_consultant_isole = false;
      } else if (isMgrFamily) {
        r.tag_haut_potentiel = false;
      }

      const sm = c.senior_manager_id ? findCollabById(c.senior_manager_id) : null;
      const smLabel = sm ? collabName(sm) : c.senior_manager_id || "—";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>
          <div style="font-weight:600">${collabName(c)}</div>
          <span class="badge-poste" style="background:${cssVar(posteColorVar(c.poste))}">${c.poste || "—"}</span>
          ${isNewSinceSnapshot(c.id) ? `<span class="badge-poste" style="background:var(--status-good)">Nouveau</span>` : ""}
        </td>
        <td>${smLabel}</td>
        <td><select data-id="${c.id}" data-field="manager_id">${mgrOptions}</select></td>
        <td><select data-id="${c.id}" data-field="chef_de_projet_id">${cpOptions}</select></td>
        <td><input type="text" data-id="${c.id}" data-field="compte_reference" value="${r.compte_reference}" placeholder="À renseigner" class="${r.compte_reference ? "" : "field-empty"}" style="width:100%;padding:5px 7px;border:1px solid var(--gridline);border-radius:6px;background:var(--surface-1);color:var(--text-primary)"></td>
        <td class="addr-cell">
          <input type="text" data-id="${c.id}" data-field="adresse_mission" value="${escAttr(r.adresse_mission)}" placeholder="Rechercher une adresse…" autocomplete="off" class="addr-input">
          <div class="addr-status"></div>
          <ul class="addr-suggestions" hidden></ul>
        </td>
        <td>
          <label class="checkbox-row"><input type="checkbox" data-id="${c.id}" data-field="tag_haut_potentiel" ${r.tag_haut_potentiel ? "checked" : ""} ${hpDisabled ? "disabled" : ""}> Haut potentiel</label>
          <label class="checkbox-row"><input type="checkbox" data-id="${c.id}" data-field="tag_en_fragilite" ${r.tag_en_fragilite ? "checked" : ""} ${otherTagsDisabled ? "disabled" : ""}> En fragilité</label>
          <label class="checkbox-row"><input type="checkbox" data-id="${c.id}" data-field="tag_consultant_isole" ${r.tag_consultant_isole ? "checked" : ""} ${otherTagsDisabled ? "disabled" : ""}> Consultant isolé</label>
        </td>
      `;
      setAddrStatus(tr.querySelector(".addr-cell"), r);
      tr.querySelector('[data-field="manager_id"]').value = r.manager_id;
      tr.querySelector('[data-field="chef_de_projet_id"]').value = r.chef_de_projet_id;
      els.tableBody.appendChild(tr);
    });

    els.tableBody.querySelectorAll("select, input:not(.addr-input)").forEach((el) => {
      el.addEventListener("change", (e) => {
        const id = e.target.dataset.id;
        const field = e.target.dataset.field;
        const r = getRattach(id);
        if (e.target.type === "checkbox") r[field] = e.target.checked;
        else r[field] = e.target.value;
      });
    });
    els.tableBody.querySelectorAll('[data-field="compte_reference"]').forEach((el) => {
      el.addEventListener("input", (e) => {
        e.target.classList.toggle("field-empty", !e.target.value.trim());
      });
    });
  }

  els.tableBody.addEventListener("input", (e) => {
    if (e.target.classList.contains("addr-input")) onAddressInput(e.target);
  });
  els.tableBody.addEventListener("click", (e) => {
    const li = e.target.closest(".addr-suggestions li");
    if (li) pickSuggestion(li);
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".addr-cell")) {
      els.tableBody.querySelectorAll(".addr-suggestions").forEach((u) => (u.hidden = true));
    }
  });

  els.search.addEventListener("input", render);
  els.filterSm.addEventListener("change", render);

  els.btnDownload.addEventListener("click", () => {
    const today = todayISO();
    const rows = [
      ["id", "manager_id", "chef_de_projet_id", "compte_reference",
        "adresse_mission", "lat", "lon",
        "tag_haut_potentiel", "tag_en_fragilite", "tag_consultant_isole", "date_maj"],
    ];
    collaborateurs.forEach((c) => {
      const r = getRattach(c.id);
      rows.push([
        c.id, r.manager_id, r.chef_de_projet_id, r.compte_reference,
        r.adresse_mission, r.lat, r.lon,
        r.tag_haut_potentiel ? "Oui" : "Non",
        r.tag_en_fragilite ? "Oui" : "Non",
        r.tag_consultant_isole ? "Oui" : "Non",
        today,
      ]);
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rattachements");
    CartoState.save("rattach", XLSX.utils.sheet_to_json(ws, { defval: "" }));
    XLSX.writeFile(wb, "rattachements.xlsx");
  });
})();
