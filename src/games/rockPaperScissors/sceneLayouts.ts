export type ScenePoint = { id: number; x: number; y: number; minSize: number; maxSize: number; depthScale: number; rotate: number; layer: number }
export type SceneLayout = { id: string; label: string; points: ScenePoint[]; campfire: { x: number; y: number; scale: number } }
const point = (id: number, x: number, y: number, minSize: number, maxSize: number, depthScale = 1): ScenePoint =>
  ({ id, x, y, minSize, maxSize, depthScale, rotate: 0, layer: 1 })
export const SCENE_LAYOUTS: SceneLayout[] = [
  { id: 'background1', label: 'Странный лес', campfire: { x: 50, y: 52, scale: 1 },
    points: [
      point(1,18,17,5,35,.8),point(2,45,19,10,45,.8),point(3,79,18,5,35,.8),
      point(4,17,38,20,60,.9),point(5,40,36,5,30,.9),point(6,82,39,25,70,.9),
      point(7,15,59,30,80,1),point(8,37,63,5,35,1),point(9,80,61,30,80,1),
      point(10,19,83,35,100,1.1),point(11,52,83,10,50,1.1),point(12,82,84,40,100,1.1)
    ] },
  { id: 'background2', label: 'Каменный век', campfire: { x: 53, y: 49, scale: 1 },
    points: [
      point(1,22,15,5,40,.8),point(2,55,18,10,50,.8),point(3,84,26,20,70,.85),
      point(4,13,34,20,70,.9),point(5,39,35,5,35,.9),point(6,76,43,10,50,.95),
      point(7,20,56,35,100,1),point(8,42,66,5,35,1),point(9,86,65,20,70,1),
      point(10,14,82,30,100,1.1),point(11,56,83,10,60,1.1),point(12,83,85,30,100,1.1)
    ] }
]
