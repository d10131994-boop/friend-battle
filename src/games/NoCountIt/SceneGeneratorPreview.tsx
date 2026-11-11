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
        <h1 style={{ marginTop: 0 }}>NoCountIt · генератор сцен</h1>
        <p>Локальная лаборатория генерации. Изменения доступны только в dev-режиме.</p>

        <section style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 16, padding: 16, borderRadius: 16, background: '#fff8e8' }}>
          <label style={{ display: 'grid', gap: 6 }}>
            Количество конфет: <strong>{count}</strong>
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
            Seed
            <input value={seed} onChange={(event) => setSeed(event.target.value)} style={{ minWidth: 0, padding: 10, border: '1px solid #c7ad86', borderRadius: 8 }} />
          </label>
          <button type="button" onClick={() => setRevision((value) => value + 1)} style={{ padding: '11px 18px', border: 0, borderRadius: 10, background: '#70452d', color: 'white', fontWeight: 800 }}>
            Новая сцена
          </button>
        </section>

        {generated.error ? (
          <section role="alert" style={{ marginTop: 16, padding: 16, borderRadius: 12, background: '#ffe0dc', color: '#8b2017' }}>
            Ошибка генерации: {generated.error}
          </section>
        ) : generated.svg ? (
          <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(220px, 300px)', gap: 20, marginTop: 20, alignItems: 'start' }}>
            <div style={{ width: '100%', maxWidth: 540, margin: '0 auto', padding: 12, borderRadius: 20, background: '#fff8e8', boxShadow: '0 8px 24px #76512a22' }}>
              <div dangerouslySetInnerHTML={{ __html: generated.svg }} />
              <h2 style={{ margin: '8px 0', textAlign: 'center', fontSize: 22 }}>
                Сколько конфет цвета «{generated.scene ? NO_COUNT_IT_TEXTS.colors[generated.scene.targetColor] : ''}»?
              </h2>
            </div>
            <aside style={{ padding: 16, borderRadius: 16, background: '#fff8e8' }}>
              <h2 style={{ marginTop: 0 }}>Параметры сцены</h2>
              <p>Всего конфет: <strong>{generated.scene?.objects.length}</strong></p>
              <p>Правильный ответ: <strong>{generated.scene?.correctCount}</strong></p>
              <p>Seed: <code>{generated.scene?.seed}</code></p>
              <h3>Распределение цветов</h3>
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
