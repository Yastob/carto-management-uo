// Lecture flexible de collaborateurs.xlsx : c'est le seul fichier saisi/maintenu à la
// main par l'utilisateur (les 2 autres sont générés par nos éditeurs), donc ni le nom de
// l'onglet ni le texte des en-têtes de colonnes ne sont fiables. On se base uniquement
// sur l'ORDRE des colonnes : la 1ère ligne de l'onglet choisi est toujours traitée comme
// un en-tête (son contenu est ignoré, quel qu'il soit) et les 5 premières colonnes de
// données doivent apparaître dans cet ordre : id, nom, prenom, poste, senior_manager_id.
// Les colonnes suivantes (ex. les colonnes d'aide id_suggestion/doublon_id de notre
// gabarit) sont ignorées.
window.CartoXlsx = (function () {
  "use strict";

  // Onglets d'aide générés par notre propre gabarit (mode d'emploi, liste cachée pour les
  // menus déroulants) : jamais l'onglet de données, à sauter lors de la détection auto.
  const NON_DATA_SHEET_NAMES = ["lisez-moi", "lisezmoi", "readme", "listes", "instructions", "mode d'emploi"];

  function isHidden(wb, name) {
    const meta = (wb.Workbook && wb.Workbook.Sheets) || [];
    const entry = meta.find((s) => s.name === name);
    return !!(entry && entry.Hidden);
  }

  function findDataSheetName(wb) {
    const candidate = (wb.SheetNames || []).find(
      (name) => !isHidden(wb, name) && !NON_DATA_SHEET_NAMES.includes(String(name).trim().toLowerCase())
    );
    return candidate || (wb.SheetNames || [])[0];
  }

  function cell(row, i) {
    const v = row[i];
    return v === undefined || v === null ? "" : String(v).trim();
  }

  const POSTES_CONNUS = ["Senior Manager", "Manager", "Chef de projet", "Directeur de projet", "Consultant"];

  // Le format étant flexible (colonnes identifiées par position, pas par nom), un fichier
  // dont les colonnes ne sont pas dans l'ordre attendu se lit "sans erreur" mais avec des
  // valeurs décalées d'une colonne — silencieusement, ce qui casse le lien SM/collaborateur
  // sans qu'on comprenne pourquoi. On détecte les 2 symptômes les plus probables et on
  // prévient tout de suite plutôt que de laisser le filtre par périmètre échouer en silence.
  function warnIfMisaligned(rows) {
    if (!rows.length) return;
    const avecPoste = rows.filter((r) => r.poste);
    if (avecPoste.length && !avecPoste.some((r) => POSTES_CONNUS.includes(r.poste))) {
      alert(
        'La colonne "poste" ne contient aucune valeur reconnue (Senior Manager / Manager / ' +
          "Chef de projet / Directeur de projet / Consultant).\n\n" +
          "Vérifie que les 5 premières colonnes de ton fichier collaborateurs sont bien, dans " +
          "cet ordre : id, nom, prenom, poste, senior_manager_id — le texte des en-têtes n'a " +
          "pas d'importance, seul l'ordre compte."
      );
      return;
    }
    const aUnSm = rows.some((r) => r.poste === "Senior Manager");
    const aUnRattachement = rows.some((r) => r.senior_manager_id);
    if (aUnSm && rows.length > 1 && !aUnRattachement) {
      alert(
        "Aucun collaborateur n'a de senior_manager_id renseigné, alors qu'un Senior Manager " +
          "existe dans le fichier.\n\n" +
          "Vérifie que la 5e colonne de ton fichier collaborateurs correspond bien à " +
          "senior_manager_id (ordre attendu : id, nom, prenom, poste, senior_manager_id)."
      );
    }
  }

  function readCollaborateurs(wb) {
    const name = findDataSheetName(wb);
    const sheet = name && wb.Sheets[name];
    if (!sheet) return [];
    const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false });
    const rows = grid
      .slice(1)
      .filter((row) => row.some((c) => String(c).trim() !== ""))
      .map((row) => ({
        id: cell(row, 0),
        nom: cell(row, 1),
        prenom: cell(row, 2),
        poste: cell(row, 3),
        senior_manager_id: cell(row, 4),
      }));
    warnIfMisaligned(rows);
    return rows;
  }

  return { readCollaborateurs };
})();
