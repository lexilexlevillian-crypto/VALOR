# Identity, appearance and residences

Character and NPC sheets use dropdowns for height, build, eyes, skin color, nationality, ethnicity, neighborhood and birthplace. Saved custom values remain selectable. Identity labels have no racial or nationality stat bonuses.

Height choices are whole inches from 4′ 3″ to 8′ 0″; storage stays in centimeters for compatibility. Below 5′ 5″ adds Short and above 5′ 11″ adds Tall. Those exact boundary heights are neutral. Slim/Lean, Stocky, Athletic, Muscular and Fat add their corresponding physical trait (Fat uses Overweight). These traits are removed from the manual trait pool. Changing the dropdown replaces the managed traits; clearing it removes them. Existing centimeter measurements, including fractional inches, survive imports, templates and unrelated edits without rounding. New dropdown selections are whole inches. Player automatic traits count toward the usual cost/refund budget; NPCs have no point budgets.

Birthplaces use an internal, server-side country → region → city directory, with city search and coordinates saved as identity metadata. Results are limited to 200 matches per query. There is no external geocoding call. Small settlements, historic names and missing places can be typed manually. Country/territory nationality choices include dual/multiple, stateless and self-described options. Ethnicity offers broad choices plus mixed identities and unrestricted self-description; the list is not claimed to exhaust every ethnic identity.

## Apartment rules

Residence appears immediately below Neighborhood. Each listed neighborhood has one residence choice. North Crowns uses The Sync. Known buildings retain their authored names; otherwise a neighborhood-named apartment block is a default, not newly asserted lore.

World Settings → Apartment floor plans edits floor and unit counts per neighborhood. Approved defaults are:
- Ordinary blocks and The Sync: 6 floors.
- Gateway area (Gateway, Ashmont, Terminal): 12 floors.
- First Harbor: 20 floors.
- Every floor: 8 apartments.

Players receive Building 1, unit 01 on a deterministic random middle floor when their life starts (The Sync: 201 or 301). NPCs can select any floor and available units 02 onward; unit 01 is reserved. Leaving the unit blank picks an available middle-floor unit, or a unit on the chosen floor. Occupied units cannot be assigned twice in the same life. Floor-plan changes do not evict existing residents.

The selected home becomes a private room connected to its building, neighborhood and city. New characters start there. Editing an existing character only moves them if they are at their previous home or have no current location. Rent and employment are not fabricated. Separate lives retain separate apartments and occupancy.

## Additional skills

The stock catalog adds Explosives, Drug production, Chemistry, Forensics, Survival, Swimming, Navigation, Crafting, Carpentry, Electrical work, Negotiation, Animal handling, Fishing, Gardening, Photography, Music and Sewing. These are fictional check ratings and descriptive game effects, not real-world procedures.

Fresh worlds include the expanded catalog. For an existing authored world, open a Creation Studio area → Developer Mode is active → **Add or refresh stock skills & traits**, review and confirm. This audited action adds missing stock entries and upgrades untouched stock descriptors without replacing custom effects or IDs. Deployment alone does not rewrite live authoring data. Publish/save the shared source for new lives to inherit it; existing lives keep their snapshots.

## Geographic data attribution and license

The local directory is provided by **Countries States Cities Database**, maintained by dr5hn and contributors:
- Source: https://github.com/dr5hn/countries-states-cities-database
- Node package source: https://github.com/dr5hn/countrystatecity-npm
- Data license: [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
- Installed package: `@countrystatecity/countries@1.0.9`.

The dataset is distributed unmodified by the dependency; VALOR performs lookups and bounded projections. Its attribution is also shown beneath the birthplace control. The database remains subject to ODbL; this notice does not change the application's license.
