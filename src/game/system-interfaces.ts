// Canonical titles and numbering: supplied 32-system PDF, index page 2.
// Storage ownership keys are retained; specialist action providers share those stores.
export const canonicalSystemReference={
  "title": "VALOR - 32 SYSTEM COMPLETE CODEX / ASTRA IMPLEMENTATION PROMPTS",
  "file": ".codex-remote-attachments/01a108d1-dce7-7ee1-ba54-77ff65b0a22c/2e1403c4-581d-4e32-82ba-0e16d29d8a7a/1-VALOR-32-SYSTEM-COMPLETE-CODEX-_-ASTRA-IMPLEMENTATION-PROMPTS.pdf",
  "sha256": "77aa846a93ed86bb5199bf8dc7c37e6b4546adda67f2223ca5f40d945b47abb4",
  "pages": 21
} as const;
export const systemInterfaces=[
  {
    "id": 1,
    "name": "Foundation and Persistent Authority",
    "owners": [],
    "source": "tests/system01-authority.test.ts",
    "reference": {
      "indexPage": 2,
      "detailPage": 3,
      "implementationPage": 9
    }
  },
  {
    "id": 2,
    "name": "Authentication, Roles, Security, and Audit",
    "owners": [],
    "source": "tests/system02-security.test.ts",
    "reference": {
      "indexPage": 2,
      "detailPage": 3,
      "implementationPage": 9
    }
  },
  {
    "id": 3,
    "name": "Campaigns, World Configuration, and Canon Boundaries",
    "owners": [
      "authored-content"
    ],
    "source": "tests/system03-campaign-canon.test.ts",
    "reference": {
      "indexPage": 2,
      "detailPage": 3,
      "implementationPage": 10
    }
  },
  {
    "id": 4,
    "name": "Valor UI Design System and Theme Engine",
    "owners": [],
    "source": "tests/system04-theme.test.ts",
    "reference": {
      "indexPage": 2,
      "detailPage": 3,
      "implementationPage": 10
    }
  },
  {
    "id": 5,
    "name": "Player Mode, Developer Mode, and Bottom-Edge Switch",
    "owners": [],
    "source": "tests/system05-mode.test.ts",
    "reference": {
      "indexPage": 2,
      "detailPage": 4,
      "implementationPage": 10
    }
  },
  {
    "id": 6,
    "name": "Main Menu, Roster, New Game, and Character Starts",
    "owners": [],
    "source": "tests/system06-entry.test.ts",
    "reference": {
      "indexPage": 2,
      "detailPage": 4,
      "implementationPage": 11
    }
  },
  {
    "id": 7,
    "name": "Character Creator and Shared Character Data",
    "owners": [
      "characters"
    ],
    "source": "tests/system07-character.test.ts",
    "reference": {
      "indexPage": 2,
      "detailPage": 4,
      "implementationPage": 11
    }
  },
  {
    "id": 8,
    "name": "Attributes, Skills, Checks, and Advancement",
    "owners": [
      "mechanics"
    ],
    "source": "tests/system08-mechanics.test.ts",
    "reference": {
      "indexPage": 2,
      "detailPage": 4,
      "implementationPage": 12
    }
  },
  {
    "id": 9,
    "name": "Trait Catalog, Backgrounds, and Custom Fields",
    "owners": [],
    "source": "tests/system09-traits.test.ts",
    "reference": {
      "indexPage": 2,
      "detailPage": 4,
      "implementationPage": 12
    }
  },
  {
    "id": 10,
    "name": "Chronicle, Narrative Input, and Scene Presentation",
    "owners": [],
    "source": "tests/system10-chronicle.test.ts",
    "reference": {
      "indexPage": 2,
      "detailPage": 4,
      "implementationPage": 12
    }
  },
  {
    "id": 11,
    "name": "Provider-Agnostic AI Gateway and Tool Contracts",
    "owners": [],
    "source": "tests/system11-ai-gateway.test.ts",
    "reference": {
      "indexPage": 2,
      "detailPage": 5,
      "implementationPage": 13
    }
  },
  {
    "id": 12,
    "name": "Context Engine, Narrative Control, and Story Directives",
    "owners": [],
    "source": "tests/system12-context.test.ts",
    "reference": {
      "indexPage": 2,
      "detailPage": 5,
      "implementationPage": 13
    }
  },
  {
    "id": 13,
    "name": "Transactional Turn Pipeline, Validation, and Retry",
    "owners": [
      "world-actions"
    ],
    "source": "tests/system13-turn-pipeline.test.ts",
    "reference": {
      "indexPage": 2,
      "detailPage": 5,
      "implementationPage": 14
    }
  },
  {
    "id": 14,
    "name": "Lore, Semantic Retrieval, Knowledge, Beliefs, and Memories",
    "owners": [
      "knowledge"
    ],
    "source": "tests/system14-epistemics.test.ts",
    "reference": {
      "indexPage": 2,
      "detailPage": 5,
      "implementationPage": 14
    }
  },
  {
    "id": 15,
    "name": "NPC Registry, Profiles, Privacy, and Creator Visibility",
    "owners": [],
    "source": "tests/system15-npc-registry.test.ts",
    "reference": {
      "indexPage": 2,
      "detailPage": 5,
      "implementationPage": 14
    }
  },
  {
    "id": 16,
    "name": "NPC Autonomy, Schedules, Goals, and Tiered Simulation",
    "owners": [],
    "source": "tests/system16-npc-autonomy.test.ts",
    "reference": {
      "indexPage": 2,
      "detailPage": 6,
      "implementationPage": 14
    }
  },
  {
    "id": 17,
    "name": "Relationships, Family, Reputation, and Social Graph",
    "owners": [
      "relationships"
    ],
    "source": "tests/system17-social-graph.test.ts",
    "reference": {
      "indexPage": 2,
      "detailPage": 6,
      "implementationPage": 15
    }
  },
  {
    "id": 18,
    "name": "Romance, Consent, Mature-Content Settings, and NPC Initiative",
    "owners": [
      "romance"
    ],
    "source": "tests/system18-romance-consent.test.ts",
    "reference": {
      "indexPage": 2,
      "detailPage": 6,
      "implementationPage": 15
    }
  },
  {
    "id": 19,
    "name": "Phone, Contacts, Calls, Texts, Voicemail, and Social Media",
    "owners": [
      "communications"
    ],
    "source": "tests/system19-phone.test.ts",
    "reference": {
      "indexPage": 2,
      "detailPage": 6,
      "implementationPage": 16
    }
  },
  {
    "id": 20,
    "name": "Items, Inventory, Clothing, Persistent Objects, and Search",
    "owners": [
      "items"
    ],
    "source": "tests/system20-items.test.ts",
    "reference": {
      "indexPage": 2,
      "detailPage": 6,
      "implementationPage": 16
    }
  },
  {
    "id": 21,
    "name": "Firearms, Weapons, Ammunition, Carry, and Ballistic Protection",
    "owners": [
      "weapons"
    ],
    "source": "tests/system21-weapons.test.ts",
    "reference": {
      "indexPage": 2,
      "detailPage": 7,
      "implementationPage": 17
    }
  },
  {
    "id": 22,
    "name": "Vehicles, Travel Assets, Vehicle Crime, and Vehicle Evidence",
    "owners": [
      "vehicles"
    ],
    "source": "tests/system22-vehicles.test.ts",
    "reference": {
      "indexPage": 2,
      "detailPage": 7,
      "implementationPage": 17
    }
  },
  {
    "id": 23,
    "name": "Health, Injury, Medicine, Substances, Death, and Aftermath",
    "owners": [
      "health"
    ],
    "source": "tests/system23-health.test.ts",
    "reference": {
      "indexPage": 2,
      "detailPage": 7,
      "implementationPage": 17
    }
  },
  {
    "id": 24,
    "name": "Combat, Violence, Restraint, Chases, and Tactical Scenes",
    "owners": [
      "combat"
    ],
    "source": "tests/system24-tactical.test.ts",
    "reference": {
      "indexPage": 2,
      "detailPage": 7,
      "implementationPage": 18
    }
  },
  {
    "id": 25,
    "name": "Time, Weather, Locations, Map, Travel, and Business Hours",
    "owners": [
      "spacetime"
    ],
    "source": "tests/system25-spacetime.test.ts",
    "reference": {
      "indexPage": 2,
      "detailPage": 7,
      "implementationPage": 18
    }
  },
  {
    "id": 26,
    "name": "Economy, Jobs, Housing, Businesses, and Optional Daily Needs",
    "owners": [
      "economy"
    ],
    "source": "tests/system26-economy.test.ts",
    "reference": {
      "indexPage": 2,
      "detailPage": 7,
      "implementationPage": 18
    }
  },
  {
    "id": 27,
    "name": "Crime, Police, Law, Dispatch, Arrest, and Lax Enforcement",
    "owners": [
      "law"
    ],
    "source": "tests/system27-law.test.ts",
    "reference": {
      "indexPage": 2,
      "detailPage": 8,
      "implementationPage": 19
    }
  },
  {
    "id": 28,
    "name": "Evidence, Investigation, Cases, Informants, and Criminal Heat",
    "owners": [
      "investigation"
    ],
    "source": "tests/system28-investigation.test.ts",
    "reference": {
      "indexPage": 2,
      "detailPage": 8,
      "implementationPage": 19
    }
  },
  {
    "id": 29,
    "name": "Factions, Gangs, Institutions, Rumors, and Living-City Conflict",
    "owners": [
      "factions"
    ],
    "source": "tests/system29-factions.test.ts",
    "reference": {
      "indexPage": 2,
      "detailPage": 8,
      "implementationPage": 20
    }
  },
  {
    "id": 30,
    "name": "Quests, Dynamic Events, Watchers, Journal, and Case Files",
    "owners": [
      "events"
    ],
    "source": "tests/system30-events.test.ts",
    "reference": {
      "indexPage": 2,
      "detailPage": 8,
      "implementationPage": 20
    }
  },
  {
    "id": 31,
    "name": "Saves, Autosaves, Timelines, Settings, Import, and Recovery",
    "owners": [],
    "source": "tests/system31-saves.test.ts",
    "reference": {
      "indexPage": 2,
      "detailPage": 8,
      "implementationPage": 20
    }
  },
  {
    "id": 32,
    "name": "Creator Studio, Admin/Debug, QA, Deployment, and Operations",
    "owners": [],
    "source": "tests/system32-release.test.ts",
    "reference": {
      "indexPage": 2,
      "detailPage": 9,
      "implementationPage": 21
    }
  }
] as const;
export function systemForOwner(owner:string){return systemInterfaces.find(system=>(system.owners as readonly string[]).includes(owner));}
export type SystemOwner=typeof systemInterfaces[number]['owners'][number];
