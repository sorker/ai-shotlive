import { ScriptData, Shot } from "../types";

export const MOCK_SCRIPT: ScriptData = {
  title: "Neon Rain",
  genre: "Cyberpunk Noir",
  logline: "A rogue android detective hunts for their creator in a city that never sleeps.",
  characters: [
    { id: "c1", name: "Kael", gender: "Male", age: "30s (Android)", personality: "Stoic, Melancholic", visualPrompt: "Cyberpunk android detective, glowing blue eyes, trench coat, rain-soaked neon city background, cinematic lighting", variations: [] },
    { id: "c2", name: "Mira", gender: "Female", age: "25", personality: "Rebellious, Hacker", visualPrompt: "Cyberpunk hacker girl, purple hair, augmented reality glasses, tactical streetwear, holding a data pad, neon alleyway", variations: [] }
  ],
  scenes: [
    { id: "s1", location: "Sector 7 Alley", time: "Night", atmosphere: "Rainy, Neon-lit", visualPrompt: "Dark alleyway in a futuristic city, heavy rain, neon signs reflecting in puddles, steam rising from vents, volumetric lighting" }
  ],
  storyParagraphs: [
    { id: 1, text: "Kael stands in the rain, looking up at the holographic billboard.", sceneRefId: "s1" }
  ]
};

export const MOCK_SHOTS: Shot[] = [
  {
    id: "shot1",
    sceneId: "s1",
    actionSummary: "Kael looks up slowly.",
    cameraMovement: "Tilt Up",
    characters: ["c1"],
    keyframes: [
      { id: "kf1a", type: "start", visualPrompt: "Medium shot of Kael, rain dripping from brim of hat, looking down, neon reflection on face", status: 'completed', imageUrl: "https://picsum.photos/seed/kf1a/800/450" },
      { id: "kf1b", type: "end", visualPrompt: "Medium shot of Kael, head tilted up looking at sky, neon light illuminating face fully", status: 'pending' }
    ],
    interval: { id: "int1", startKeyframeId: "kf1a", endKeyframeId: "kf1b", duration: 3, motionStrength: 5, status: 'pending' }
  },
  {
    id: "shot2",
    sceneId: "s1",
    actionSummary: "Mira steps out from the shadows.",
    cameraMovement: "Static",
    characters: ["c2"],
    keyframes: [
      { id: "kf2a", type: "start", visualPrompt: "Wide shot of alley, silhouette of Mira emerging from steam in background", status: 'pending' },
      { id: "kf2b", type: "end", visualPrompt: "Wide shot, Mira fully visible in mid-ground, holding a glowing device", status: 'pending' }
    ],
    interval: { id: "int2", startKeyframeId: "kf2a", endKeyframeId: "kf2b", duration: 4, motionStrength: 3, status: 'pending' }
  }
];