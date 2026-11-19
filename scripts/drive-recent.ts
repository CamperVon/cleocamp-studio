/**
 * Store the five Cleo Camp Google Drive files edited most recently, for the
 * Drive page. The app has no Google key, so a scheduled Claude run calls the
 * Google Drive connector's search_files with recentQuery() (orderBy
 * "modifiedTime desc", pageSize 10, includeRichMetadata true), saves the
 * result as JSON and runs:
 *
 *   npx tsx scripts/drive-recent.ts --file <result.json>
 *   npx tsx scripts/drive-recent.ts --query      (prints the search to use)
 */
import { readFileSync } from 'node:fs'
import { db } from '@/lib/db'
import { pickRecent, recentQuery, replaceRecent } from '@/lib/drive'

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--query')) { console.log(recentQuery()); return }
  const fi = args.indexOf('--file')
  if (fi < 0 || !args[fi + 1]) throw new Error('Usage: --file <search_files result.json>  |  --query')
  const raw = JSON.parse(readFileSync(args[fi + 1], 'utf8'))
  const files = Array.isArray(raw) ? raw : raw.files ?? []
  const picked = pickRecent(files)
  if (!picked.length) { console.log(JSON.stringify({ stored: 0, reason: 'no files in the result; the old list is kept' })); return }
  const n = await replaceRecent(picked)
  console.log(JSON.stringify({ stored: n, titles: picked.map((p) => p.title) }, null, 1))
}

main().then(() => db.$disconnect(), (e) => { console.error(e); return db.$disconnect().then(() => process.exit(1)) })
