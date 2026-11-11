import type { NoCountItCandyColor, NoCountItScene, NoCountItSceneObject } from '../types'

const PALETTE: Record<NoCountItCandyColor, { base: string; light: string; dark: string }> = {
  red: { base: '#D95755', light: '#F28A7B', dark: '#983B43' },
  orange: { base: '#E98C42', light: '#F7B96F', dark: '#B95E32' },
  yellow: { base: '#E7C94E', light: '#F7E58A', dark: '#B99736' },
  green: { base: '#65A978', light: '#9BD19A', dark: '#3F795B' },
  blue: { base: '#5B91C5', light: '#9CC4E5', dark: '#3D638F' },
  purple: { base: '#9675B7', light: '#C0A1D8', dark: '#6B508E' },
  pink: { base: '#D77FA0', light: '#F1B2C5', dark: '#A9567D' },
  teal: { base: '#55AFA9', light: '#91D5C9', dark: '#367D7B' },
  white: { base: '#E8E4D9', light: '#FFFFFF', dark: '#B9B5AB' },
  brown: { base: '#9C7055', light: '#C49A78', dark: '#694A3B' },
}

function renderCandy(object: NoCountItSceneObject): string {
  const color = PALETTE[object.color]
  const gradientId = `candy-gradient-${object.id}`
  const transform = `translate(${object.x} ${object.y}) rotate(${object.rotation}) scale(${object.scale})`
  const shape = object.shape === 'wrapped'
    ? `<path d="M-29 -11 L-22 -6 L-22 6 L-29 11 L-25 0 Z M29 -11 L22 -6 L22 6 L29 11 L25 0 Z" fill="url(#${gradientId})"/><rect x="-22" y="-15" width="44" height="30" rx="14" fill="url(#${gradientId})"/>`
    : object.shape === 'oval'
      ? `<ellipse cx="0" cy="0" rx="29" ry="22" fill="url(#${gradientId})"/>`
      : `<circle cx="0" cy="0" r="29" fill="url(#${gradientId})"/>`

  return `<g transform="${transform}"><defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color.light}"/><stop offset=".56" stop-color="${color.base}"/><stop offset="1" stop-color="${color.dark}"/></linearGradient></defs>${shape}<ellipse cx="-9" cy="-11" rx="8" ry="4" fill="#FFFFFF" opacity=".22"/></g>`
}

export function renderCandyJarSvg(scene: NoCountItScene): string {
  if (scene.version !== 1 || scene.generator !== 'candy-jar') {
    throw new Error('Unsupported NoCountIt scene version or generator.')
  }
  const candies = scene.objects.map(renderCandy).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="auto" viewBox="0 0 1000 1000" role="img" aria-label="Банка с разноцветными конфетами">
  <defs>
    <clipPath id="jar-interior"><path d="M255 145 Q255 115 290 115 H710 Q745 115 745 145 L790 215 Q825 270 825 340 V790 Q825 900 715 920 H285 Q175 900 175 790 V340 Q175 270 210 215 Z"/></clipPath>
    <linearGradient id="glass-edge" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#B7D7D9" stop-opacity=".55"/><stop offset=".18" stop-color="#FFFFFF" stop-opacity=".08"/><stop offset=".82" stop-color="#FFFFFF" stop-opacity=".08"/><stop offset="1" stop-color="#B7D7D9" stop-opacity=".55"/></linearGradient>
  </defs>
  <g clip-path="url(#jar-interior)"><!-- CANDIES -->${candies}</g>
  <path d="M255 145 Q255 115 290 115 H710 Q745 115 745 145 L790 215 Q825 270 825 340 V790 Q825 900 715 920 H285 Q175 900 175 790 V340 Q175 270 210 215 Z" fill="url(#glass-edge)" fill-opacity=".28" stroke="#A8C9CB" stroke-opacity=".72" stroke-width="13"/>
  <path d="M260 105 Q260 80 292 80 H708 Q740 80 740 105 V135 Q740 155 710 155 H290 Q260 155 260 135 Z" fill="#D8E6E3" fill-opacity=".65" stroke="#A8C9CB" stroke-width="11"/>
  <path d="M270 85 Q500 65 730 85" fill="none" stroke="#A8C9CB" stroke-opacity=".6" stroke-width="8"/>
  <path d="M465 82 C430 25 385 48 420 92 C445 115 470 100 500 90 C530 100 555 115 580 92 C615 48 570 25 535 82" fill="#D98A9D" stroke="#A95F76" stroke-width="7"/>
  <circle cx="500" cy="91" r="17" fill="#E9A7B5" stroke="#A95F76" stroke-width="6"/>
  </svg>`
}
