import { useMemo, useState } from 'react'
import { CANDY_GENERATION_CONFIG } from './generationConfig'
import { createSeededRandom, generateCandyJarScene } from './scene/sceneGenerator'
import { CANDY_PALETTE, renderCandyJarSvg } from './scene/svgRenderer'
import type { NoCountItPaletteColor } from './types'
import { NO_COUNT_IT_TEXTS } from './texts'

const BACKGROUND_IMAGES = import.meta.glob<string>('./backgrounds/*.{png,jpg,jpeg,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
})
const CANDY_COLORS = Object.keys(CANDY_PALETTE) as NoCountItPaletteColor[]

export default function SceneGeneratorPreview() {
  const [count, setCount] = useState(80)
  const [seed, setSeed] = useState('no-count-it-preview-001')
  const [revision, setRevision] = useState(0)

  const generated = useMemo(() => {
    try {
      const scene = generateCandyJarScene({
        seed: `${seed}-${revision}`,
        minCandies: count,
        maxCandies: count,
        maxColors: CANDY_COLORS.length - 1,
      })
      const random = createSeededRandom(`${scene.seed}-layers`)
      const backgroundColor = scene.backgroundColor
      const backgroundPaths = Object.keys(BACKGROUND_IMAGES).sort()
      const backgroundPath = backgroundPaths.length
        ? backgroundPaths[Math.floor(random() * backgroundPaths.length)]
        : null

      return {
        svg: renderCandyJarSvg(scene),
        scene,
        backgroundColor,
        backgroundImage: backgroundPath ? BACKGROUND_IMAGES[backgroundPath] : null,
        backgroundPath,
        error: null,
      }
    } catch (error) {
      return {
        svg: null,
        scene: null,
        backgroundColor: null,
        backgroundImage: null,
        backgroundPath: null,
        error: error instanceof Error ? error.message : NO_COUNT_IT_TEXTS.preview.fallbackError,
      }
    }
  }, [count, seed, revision])

  const colorCounts = generated.scene?.objects.reduce<Record<string, number>>((result, candy) => {
    result[candy.color] = (result[candy.color] ?? 0) + 1
    return result
  }, {}) ?? {}

  return (
    <main style={{ minHeight: '100vh', padding: 20, background: '#f3e5bd', color: '#563a27', fontFamily: 'Nunito, sans-serif' }}>
      <div style={{ width: 'min(100%, 980px)', margin: '0 auto' }}>
        <h1 style={{ marginTop: 0 }}>{NO_COUNT_IT_TEXTS.preview.title}</h1>
        <p>{NO_COUNT_IT_TEXTS.preview.description}</p>

        <section style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 16, padding: 16, borderRadius: 16, background: '#fff8e8' }}>
          <label style={{ display: 'grid', gap: 6 }}>
            {NO_COUNT_IT_TEXTS.preview.candyCount} <strong>{count}</strong>
            <input
              type="range"
              min={CANDY_GENERATION_CONFIG.minCandyCount}
              max={CANDY_GENERATION_CONFIG.maxCandyCount}
              step="1"
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
            />
          </label>
          <label style={{ display: 'grid', gap: 6, flex: '1 1 220px' }}>
            {NO_COUNT_IT_TEXTS.preview.seedLabel}
            <input value={seed} onChange={(event) => setSeed(event.target.value)} style={{ minWidth: 0, padding: 10, border: '1px solid #c7ad86', borderRadius: 8 }} />
          </label>
          <button type="button" onClick={() => setRevision((value) => value + 1)} style={{ padding: '11px 18px', border: 0, borderRadius: 10, background: '#70452d', color: 'white', fontWeight: 800 }}>
            {NO_COUNT_IT_TEXTS.preview.newScene}
          </button>
        </section>

        {generated.error ? (
          <section role="alert" style={{ marginTop: 16, padding: 16, borderRadius: 12, background: '#ffe0dc', color: '#8b2017' }}>
            {NO_COUNT_IT_TEXTS.preview.generationError} {generated.error}
          </section>
        ) : generated.svg && generated.scene && generated.backgroundColor ? (
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 20, marginTop: 20, alignItems: 'start' }}>
            <div style={{ width: '100%', maxWidth: 360, aspectRatio: '3 / 4', boxSizing: 'border-box', position: 'relative', display: 'flex', flexDirection: 'column', gap: 10, margin: '0 auto', padding: 14, overflow: 'hidden', border: '8px solid #4b4038', borderRadius: 28, background: '#f3e5bd', boxShadow: '0 8px 24px #76512a33' }}>
              {generated.backgroundImage && (
                <img
                  src={generated.backgroundImage}
                  alt=""
                  aria-hidden="true"
                  style={{ position: 'absolute', inset: 0, zIndex: 1, width: '100%', height: '100%', objectFit: 'cover' }}
                />
              )}
              <div style={{ position: 'relative', zIndex: 2, flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ alignSelf: 'center', padding: '7px 13px', borderRadius: 999, background: '#fff8e8ef', border: '2px solid #70452d66', boxShadow: '0 3px 10px #38231533', fontWeight: 900, letterSpacing: 1 }}>
                  00:05
                </div>
                <div style={{ flex: '1 1 auto', minHeight: 0, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ width: '100%', maxHeight: '100%' }} dangerouslySetInnerHTML={{ __html: generated.svg }} />
                </div>
                <h2 style={{ flex: '0 0 auto', width: '100%', boxSizing: 'border-box', margin: 0, padding: '10px 8px', borderRadius: 14, background: '#fff8e8f2', border: '2px solid #70452d55', boxShadow: '0 3px 10px #38231533', textAlign: 'center', fontSize: 19, lineHeight: 1.2 }}>
                  {NO_COUNT_IT_TEXTS.preview.questionPrefix}{NO_COUNT_IT_TEXTS.colors[generated.scene.targetColor]}»?
                </h2>
              </div>
            </div>
            <aside style={{ padding: 16, borderRadius: 16, background: '#fff8e8' }}>
              <h2 style={{ marginTop: 0 }}>{NO_COUNT_IT_TEXTS.preview.sceneParameters}</h2>
              <p>{NO_COUNT_IT_TEXTS.preview.totalCandies} <strong>{generated.scene.objects.length}</strong></p>
              <p>{NO_COUNT_IT_TEXTS.preview.correctAnswer} <strong>{generated.scene.correctCount}</strong></p>
              <p>{NO_COUNT_IT_TEXTS.preview.seedLabel}: <code>{generated.scene.seed}</code></p>
              <p>Цвет нижнего слоя: <strong>{NO_COUNT_IT_TEXTS.colors[generated.backgroundColor]}</strong></p>
              <p>Фон: <strong>{generated.backgroundPath ?? 'изображения пока не добавлены'}</strong></p>
              <h3>{NO_COUNT_IT_TEXTS.preview.colorDistribution}</h3>
              {Object.entries(colorCounts).map(([color, amount]) => (
                <div key={color} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #eadcc4' }}>
                  <span>{NO_COUNT_IT_TEXTS.colors[color as keyof typeof NO_COUNT_IT_TEXTS.colors]}</span><strong>{amount}</strong>
                </div>
              ))}
              {!generated.backgroundImage && <p style={{ fontSize: 13, opacity: 0.8 }}>{NO_COUNT_IT_TEXTS.preview.backgroundFilesMissing}</p>}
            </aside>
          </section>
        ) : null}
      </div>
    </main>
  )
}
