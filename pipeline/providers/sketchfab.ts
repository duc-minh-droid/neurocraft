import path from 'node:path'
import type { AssetSource } from '../../shared/meta.ts'
import { PREVIEW_DIR, download, env } from '../util.ts'

const API = 'https://api.sketchfab.com/v3'

export interface SearchOptions {
  count?: number
  animated?: boolean
  rigged?: boolean
  maxFaces?: number
  sort?: 'relevance' | 'likes' | 'views' | 'recent'
}

export interface Candidate {
  uid: string
  name: string
  author: string
  license: string
  faces: number
  animations: number
  glbMB: number
  likes: number
  thumbnail: string
  url: string
}

interface SearchResult {
  uid: string
  name: string
  viewerUrl: string
  likeCount: number
  animationCount: number
  faceCount: number
  isAgeRestricted: boolean
  user: { displayName: string }
  license?: { label: string }
  archives?: { glb?: { size: number; faceCount: number } }
  thumbnails: { images: { url: string; width: number }[] }
}

const SORTS = { likes: '-likeCount', views: '-viewCount', recent: '-publishedAt' } as const

export async function search(q: string, opts: SearchOptions = {}): Promise<Candidate[]> {
  const params = new URLSearchParams({ type: 'models', q, downloadable: 'true', count: String(opts.count ?? 12) })
  if (opts.animated) params.set('animated', 'true')
  if (opts.rigged) params.set('rigged', 'true')
  if (opts.maxFaces) params.set('max_face_count', String(opts.maxFaces))
  if (opts.sort && opts.sort !== 'relevance') params.set('sort_by', SORTS[opts.sort])
  const res = await fetch(`${API}/search?${params}`)
  if (!res.ok) throw new Error(`Sketchfab search failed ${res.status}`)
  const { results } = (await res.json()) as { results: SearchResult[] }
  return results
    .filter((m) => !m.isAgeRestricted && m.archives?.glb)
    .map((m) => ({
      uid: m.uid,
      name: m.name,
      author: m.user.displayName,
      license: m.license?.label ?? 'unknown',
      faces: m.archives?.glb?.faceCount ?? m.faceCount,
      animations: m.animationCount,
      glbMB: +((m.archives?.glb?.size ?? 0) / 1e6).toFixed(1),
      likes: m.likeCount,
      thumbnail: [...m.thumbnails.images].sort((a, b) => Math.abs(a.width - 720) - Math.abs(b.width - 720))[0]?.url,
      url: m.viewerUrl,
    }))
}

export async function downloadThumbnail(c: Candidate) {
  return download(c.thumbnail, path.join(PREVIEW_DIR, 'thumbs', `${c.uid}.jpg`))
}

/** Downloads the GLB archive and returns its local path plus attribution info. */
export async function fetchModel(uid: string, dest: string, onProgress?: (pct: number, mb: number) => void): Promise<{ file: string; source: AssetSource; thumbnail?: string }> {
  const auth = { Authorization: `Token ${env('SKETCHFAB_API_TOKEN')}` }
  const [dl, info] = await Promise.all([
    fetch(`${API}/models/${uid}/download`, { headers: auth }).then((r) => {
      if (!r.ok) throw new Error(`Sketchfab download ${uid} failed ${r.status}`)
      return r.json() as Promise<{ glb?: { url: string } }>
    }),
    fetch(`${API}/models/${uid}`).then(
      (r) =>
        r.json() as Promise<{
          name: string
          viewerUrl: string
          user: { displayName: string; profileUrl: string }
          license?: { label: string; url: string }
          thumbnails?: { images: { url: string; width: number }[] }
        }>,
    ),
  ])
  if (!dl.glb) throw new Error(`Sketchfab model ${uid} has no GLB archive`)
  await download(dl.glb.url, dest, onProgress)
  return {
    file: dest,
    thumbnail: [...(info.thumbnails?.images ?? [])].sort((a, b) => Math.abs(a.width - 720) - Math.abs(b.width - 720))[0]?.url,
    source: {
      type: 'sketchfab',
      uid,
      name: info.name,
      author: info.user.displayName,
      authorUrl: info.user.profileUrl,
      license: info.license?.label,
      licenseUrl: info.license?.url,
      url: info.viewerUrl,
    },
  }
}
