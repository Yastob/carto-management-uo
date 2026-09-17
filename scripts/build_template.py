"""Génère des gabarits vierges (avec exemples) : collaborateurs.xlsx, rattachements.xlsx, reunions.xlsx."""
from template_builders import (
    build_collaborateurs_workbook,
    build_rattachements_workbook,
    build_points_workbook,
)

collab_rows = [
    dict(id="C001", nom="Dupont", prenom="Marie", poste="Senior Manager", senior_manager_id="", _example=True),
    dict(id="C002", nom="Martin", prenom="Julie", poste="Senior Manager", senior_manager_id="", _example=True),
    dict(id="C003", nom="Bernard", prenom="Alex", poste="Consultant", senior_manager_id="C001", _example=True),
    dict(id="C004", nom="Lefevre", prenom="Sam", poste="Consultant", senior_manager_id="C001", _example=True),
    dict(id="C005", nom="Petit", prenom="Nadia", poste="Manager", senior_manager_id="C002", _example=True),
    dict(id="C006", nom="Moreau", prenom="Tom", poste="Chef de projet", senior_manager_id="C001", _example=True),
    dict(id="C007", nom="Dubois", prenom="Eva", poste="Consultant", senior_manager_id="C002", _example=True),
]

rattach_rows = [
    dict(id="C001", manager_id="", chef_de_projet_id="", compte_reference="",
         tag_haut_potentiel="Non", tag_en_fragilite="Non", tag_consultant_isole="Non",
         date_maj="2026-09-01", _example=True),
    dict(id="C002", manager_id="", chef_de_projet_id="", compte_reference="",
         tag_haut_potentiel="Non", tag_en_fragilite="Non", tag_consultant_isole="Non",
         date_maj="2026-09-01", _example=True),
    dict(id="C003", manager_id="C005", chef_de_projet_id="", compte_reference="",
         tag_haut_potentiel="Oui", tag_en_fragilite="Non", tag_consultant_isole="Non",
         date_maj="2026-09-01", _example=True),
    dict(id="C004", manager_id="", chef_de_projet_id="C006", compte_reference="",
         tag_haut_potentiel="Non", tag_en_fragilite="Non", tag_consultant_isole="Non",
         date_maj="2026-09-05", _example=True),
    dict(id="C005", manager_id="", chef_de_projet_id="", compte_reference="Client A",
         tag_haut_potentiel="Non", tag_en_fragilite="Non", tag_consultant_isole="Non",
         date_maj="2026-09-01", _example=True),
    dict(id="C006", manager_id="", chef_de_projet_id="", compte_reference="",
         tag_haut_potentiel="Non", tag_en_fragilite="Non", tag_consultant_isole="Non",
         date_maj="2026-09-01", _example=True),
    dict(id="C007", manager_id="", chef_de_projet_id="", compte_reference="",
         tag_haut_potentiel="Non", tag_en_fragilite="Oui", tag_consultant_isole="Oui",
         date_maj="2026-09-01", _example=True),
]

point_rows = [
    dict(id="P001", nom="Réunion d'équipe transverse Data", animateur_id="C005",
         participants_ids="C003,C004,C007", type="Equipe", periodicite="Hebdomadaire",
         ordre_du_jour="Avancement missions, alertes, actus UO",
         date_maj="2026-09-01", _example=True),
    dict(id="P002", nom="Réunion individuelle Alex", animateur_id="C005",
         participants_ids="C003", type="Individuel", periodicite="Mensuel",
         ordre_du_jour="Charge, montée en compétence, objectifs",
         date_maj="2026-09-01", _example=True),
    dict(id="P003", nom="Comité Managers & CP", animateur_id="C001",
         participants_ids="C002,C005,C006", type="Equipe", periodicite="Tous les 2 mois",
         ordre_du_jour="Suivi RH du périmètre, arbitrages",
         date_maj="2026-09-01", _example=True),
]

if __name__ == "__main__":
    build_collaborateurs_workbook(collab_rows).save("data/collaborateurs.xlsx")
    build_rattachements_workbook(rattach_rows).save("data/rattachements.xlsx")
    build_points_workbook(point_rows).save("data/reunions.xlsx")
    print("OK: data/collaborateurs.xlsx, data/rattachements.xlsx et data/reunions.xlsx générés")
