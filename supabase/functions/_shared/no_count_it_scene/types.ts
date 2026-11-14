export type NoCountItCandyColor =
  | "red" | "orange" | "yellow" | "green" | "blue"
  | "purple" | "pink" | "teal" | "brown";
export type NoCountItPaletteColor = NoCountItCandyColor | "white";
export interface NoCountItScene {
  version: 1;
  seed: string;
  generator: "candy-jar";
  objects: NoCountItSceneObject[];
  targetColor: NoCountItCandyColor;
  backgroundColor: NoCountItPaletteColor;
  correctCount: number;
}
export interface NoCountItSceneObject {
  id: number; x: number; y: number; rotation: number; scale: number;
  color: NoCountItCandyColor; shape: "round" | "oval" | "wrapped";
}
