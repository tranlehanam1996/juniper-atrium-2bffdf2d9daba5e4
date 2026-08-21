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
