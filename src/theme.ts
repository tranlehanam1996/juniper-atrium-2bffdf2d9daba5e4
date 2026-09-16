import type { ThemeConfig } from "./types";

export const theme = {
  "id": "pets",
  "product": "Pet Care Atlas",
  "tagline": "Keep routine care, supplies, and appointments visible in one calm view.",
  "itemLabel": "Care item",
  "dateLabel": "Due date",
  "effortLabel": "Minutes",
  "impactLabel": "Care priority",
  "categories": [
    "Health",
    "Grooming",
    "Exercise",
    "Supplies",
    "Training"
  ],
  "templates": [
    { title: "Weekly Bath", category: "Grooming", effort: 45, impact: 3 },
    { title: "Monthly Nail Trim", category: "Grooming", effort: 20, impact: 4 },
    { title: "Daily Walk", category: "Exercise", effort: 30, impact: 5 },
    { title: "Heartworm Meds", category: "Health", effort: 5, impact: 5 },
    { title: "Training Session", category: "Training", effort: 15, impact: 3 }
  ],
  "seeds": [
    [
      "Restock dry food",
      "Supplies",
      20,
      5
    ],
    [
      "Brush coat",
      "Grooming",
      15,
      3
    ],
    [
      "Practice recall cue",
      "Training",
      20,
      4
    ]
  ]
} as const satisfies ThemeConfig;