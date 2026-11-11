import { useMemo, useState } from 'react'
import { CANDY_GENERATION_CONFIG } from './generationConfig'
import { generateCandyJarScene } from './scene/sceneGenerator'
import { renderCandyJarSvg } from './scene/svgRenderer'
import { NO_COUNT_IT_TEXTS } from './texts'

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
      })
      return { svg: renderCandyJarSvg(scene), scene, error: null }
    } catch (error) {
      return {
        svg: null,
        scene: null,
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
        ) : generated.svg ? (
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 20, marginTop: 20, alignItems: 'start' }}>
            <div style={{ width: '100%', maxWidth: 360, aspectRatio: '3 / 4', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 10, margin: '0 auto', padding: 14, overflow: 'hidden', border: '8px solid #4b4038', borderRadius: 28, background: '#d9d1c2', boxShadow: '0 8px 24px #76512a33' }}>
              <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: '100%' }} dangerouslySetInnerHTML={{ __html: generated.svg }} />
              </div>
              <h2 style={{ flex: '0 0 auto', margin: 0, padding: '8px 4px', borderRadius: 12, background: '#fff8e8', textAlign: 'center', fontSize: 20, lineHeight: 1.2 }}>
                {NO_COUNT_IT_TEXTS.preview.questionPrefix}{generated.scene ? NO_COUNT_IT_TEXTS.colors[generated.scene.targetColor] : ''}»?
              </h2>
            </div>
            <aside style={{ padding: 16, borderRadius: 16, background: '#fff8e8' }}>
              <h2 style={{ marginTop: 0 }}>{NO_COUNT_IT_TEXTS.preview.sceneParameters}</h2>
              <p>{NO_COUNT_IT_TEXTS.preview.totalCandies} <strong>{generated.scene?.objects.length}</strong></p>
              <p>{NO_COUNT_IT_TEXTS.preview.correctAnswer} <strong>{generated.scene?.correctCount}</strong></p>
              <p>{NO_COUNT_IT_TEXTS.preview.seedLabel}: <code>{generated.scene?.seed}</code></p>
              <h3>{NO_COUNT_IT_TEXTS.preview.colorDistribution}</h3>
              {Object.entries(colorCounts).map(([color, amount]) => (
                <div key={color} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #eadcc4' }}>
                  <span>{NO_COUNT_IT_TEXTS.colors[color as keyof typeof NO_COUNT_IT_TEXTS.colors]}</span><strong>{amount}</strong>
                </div>
              ))}
            </aside>
          </section>
        ) : null}
      </div>
    </main>
  )
}
