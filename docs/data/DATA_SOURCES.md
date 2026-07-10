# Data-source policy

Every adapter and stored source snapshot must record:

- provider and canonical source URL;
- retrieval time and, when known, validity window;
- license and required attribution;
- caching, redistribution, and deletion restrictions;
- content hash and parser version;
- source class and confidence;
- whether the data may be sent to a model.

## Initial research candidates

| Purpose             | Candidate                                              | Foundation posture                                                              |
| ------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Places              | Overture, OpenStreetMap, Wikidata, Wikivoyage          | Evaluate licenses and attribution per field                                     |
| Maps                | MapLibre and self-hosted/regional PMTiles              | Avoid dependence on public tile infrastructure                                  |
| Weather             | Open-Meteo                                             | Non-commercial/open-source terms; self-host or contract before commercial scale |
| Advisories          | Government feeds and content APIs                      | Official source cards with citizen-context labels                               |
| Disasters           | GDACS and official geological feeds                    | Action cards, not an opaque aggregate score                                     |
| Health              | WHO outbreak information                               | Official source and date required                                               |
| Flights/hotels      | Sandbox or approved partner adapters                   | Never claim comprehensive live inventory without a contract                     |
| Community sentiment | Approved APIs, user-provided links, or licensed search | No unauthorized scraping or bulk retention                                      |

`Not checked` is a first-class state and must never be collapsed into `Clear`.
