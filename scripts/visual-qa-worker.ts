import { hostname, homedir, tmpdir } from 'os'
import { join, resolve } from 'path'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { spawn } from 'child_process'
import { createSupabaseAdminClient } from '../lib/supabase'
import {
  clearVisualQaPendingMarker,
  failVisualQaJob,
  finalizeApprovedVisualQaJob,
  readVisualQaJob,
  VISUAL_QA_BUCKET,
  visualQaArtifactPath,
  visualQaPendingPath,
  writeVisualQaJob,
  type VisualQaJob,
  type VisualQaReport,
} from '../lib/visual-qa'

const WORKER_ID = `${hostname()}-${process.pid}`
const WATCH = process.argv.includes('--watch')
const POLL_MS = 10_000
const RENDER_LEASE_MS = 15 * 60_000

function findPython(): string {
  const candidates = [
    process.env.QA_PYTHON_PATH,
    join(homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe'),
  ].filter((candidate): candidate is string => Boolean(candidate))
  const found = candidates.find(existsSync)
  if (!found) throw new Error('QA Python runtime was not found. Set QA_PYTHON_PATH.')
  return found
}

function findPowerShell(): string {
  const candidates = [
    process.env.QA_POWERSHELL_PATH,
    join(homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'native', 'powershell', 'pwsh.exe'),
  ].filter((candidate): candidate is string => Boolean(candidate))
  const found = candidates.find(existsSync)
  if (!found) throw new Error('QA PowerShell 7 runtime was not found. Set QA_POWERSHELL_PATH.')
  return found
}

async function runPowerShell(script: string, args: string[], wordPidPath: string): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const timeoutMs = Number(process.env.QA_RENDER_TIMEOUT_MS ?? 180_000)
    let timedOut = false
    const child = spawn(findPowerShell(), [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args,
    ], { stdio: 'inherit', windowsHide: true })
    const timer = setTimeout(() => {
      timedOut = true
      void readFile(wordPidPath, 'utf8').then((value) => {
        const wordPids = value.split(/\s+/)
          .map(Number)
          .filter((wordPid) => Number.isInteger(wordPid) && wordPid > 0)
        for (const wordPid of wordPids) {
          const wordKiller = spawn('taskkill.exe', ['/PID', String(wordPid), '/T', '/F'], {
            stdio: 'ignore', windowsHide: true,
          })
          wordKiller.unref()
        }
      }).catch(() => undefined)
      if (child.pid) {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore', windowsHide: true,
        })
        killer.unref()
      }
    }, Number.isFinite(timeoutMs) && timeoutMs >= 30_000 ? timeoutMs : 180_000)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolvePromise(timedOut ? 124 : (code ?? 1))
    })
  })
}

async function uploadFile(path: string, localPath: string, contentType: string): Promise<void> {
  const supabase = createSupabaseAdminClient()
  const { error } = await supabase.storage.from(VISUAL_QA_BUCKET).upload(
    path,
    await readFile(localPath),
    { contentType, upsert: true },
  )
  if (error) throw new Error(`QA artifact upload failed (${path}): ${error.message}`)
}

async function heartbeat(status: string): Promise<void> {
  const supabase = createSupabaseAdminClient()
  await supabase.storage.from(VISUAL_QA_BUCKET).upload(
    'qa/worker/heartbeat.json',
    Buffer.from(JSON.stringify({ workerId: WORKER_ID, status, updatedAt: new Date().toISOString() })),
    { contentType: 'application/json', upsert: true },
  )
}

async function isWordAlreadyRunning(): Promise<boolean> {
  return new Promise((resolvePromise, reject) => {
    let output = ''
    const child = spawn('tasklist.exe', ['/FI', 'IMAGENAME eq WINWORD.EXE', '/FO', 'CSV', '/NH'], {
      windowsHide: true,
    })
    child.stdout.on('data', (chunk) => { output += String(chunk) })
    child.on('error', reject)
    child.on('exit', () => resolvePromise(/"WINWORD\.EXE"/i.test(output)))
  })
}

async function processJob(job: VisualQaJob): Promise<void> {
  const supabase = createSupabaseAdminClient()
  let current = await writeVisualQaJob(supabase, {
    ...job,
    status: 'rendering',
    workerId: WORKER_ID,
    startedAt: new Date().toISOString(),
    failure: undefined,
  })
  await heartbeat(`rendering:${job.id}`)

  const tempRoot = await mkdtemp(join(tmpdir(), 'tassure-proposal-qa-'))
  try {
    const docxPath = join(tempRoot, 'proposal.docx')
    const outputDir = join(tempRoot, 'render')
    const reportPath = join(outputDir, 'report.json')
    const contactSheetPath = join(outputDir, 'contact-sheet.png')
    const wordPidPath = join(tempRoot, 'word.pid')
    const wordStagePath = join(tempRoot, 'word.stage.txt')
    const { data: draft, error: draftError } = await supabase.storage
      .from(VISUAL_QA_BUCKET)
      .download(current.draftPath)
    if (draftError || !draft) throw new Error(`Draft download failed: ${draftError?.message ?? 'missing file'}`)
    await writeFile(docxPath, Buffer.from(await draft.arrayBuffer()))

    const renderScript = resolve(process.cwd(), 'scripts', 'render-proposal-word-qa.ps1')
    const exitCode = await runPowerShell(renderScript, [
      '-DocxPath', docxPath,
      '-OutputDir', outputDir,
      '-ReportPath', reportPath,
      '-PythonPath', findPython(),
      '-PidPath', wordPidPath,
    ], wordPidPath)
    if (!existsSync(reportPath)) {
      const stage = existsSync(wordStagePath) ? (await readFile(wordStagePath, 'utf8')).trim() : 'not-started'
      throw new Error(`Word render did not produce a QA report (exit ${exitCode}, stage ${stage})`)
    }

    const report = JSON.parse(await readFile(reportPath, 'utf8')) as VisualQaReport
    await uploadFile(visualQaArtifactPath(current.id, 'report.json'), reportPath, 'application/json')
    await uploadFile(visualQaArtifactPath(current.id, 'contact-sheet.png'), contactSheetPath, 'image/png')
    current = await writeVisualQaJob(supabase, { ...current, report })

    if (report.errors.length > 0 || exitCode !== 0) {
      await failVisualQaJob(supabase, current, 'failed', report.errors.join('; ') || `Renderer exit ${exitCode}`)
    } else if (report.warnings.length > 0) {
      await writeVisualQaJob(supabase, {
        ...current,
        status: 'review_required',
        completedAt: new Date().toISOString(),
        failure: report.warnings.join('; '),
      })
      await clearVisualQaPendingMarker(supabase, current.id)
    } else {
      await finalizeApprovedVisualQaJob(supabase, current, { mode: 'automatic' })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await failVisualQaJob(supabase, current, 'failed', message)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
    await heartbeat('idle')
  }
}

async function processPending(): Promise<number> {
  const supabase = createSupabaseAdminClient()
  const { data: pending, error } = await supabase.storage
    .from(VISUAL_QA_BUCKET)
    .list('qa/pending', { limit: 20, sortBy: { column: 'created_at', order: 'asc' } })
  if (error) throw new Error(`Pending QA list failed: ${error.message}`)

  let processed = 0
  for (const marker of pending ?? []) {
    if (!marker.name.endsWith('.json')) continue
    const jobId = marker.name.replace(/\.json$/i, '')
    let job = await readVisualQaJob(supabase, jobId)
    if (!job) {
      await supabase.storage.from(VISUAL_QA_BUCKET).remove([visualQaPendingPath(jobId)])
      continue
    }
    if (job.status === 'rendering') {
      const startedAt = job.startedAt ? new Date(job.startedAt).getTime() : 0
      const leaseExpired = !Number.isFinite(startedAt) || Date.now() - startedAt > RENDER_LEASE_MS
      if (!leaseExpired) continue
      job = await writeVisualQaJob(supabase, {
        ...job,
        status: 'pending',
        startedAt: undefined,
        workerId: undefined,
        failure: 'Previous Word render stopped before completion; automatically retrying.',
      })
    }
    if (job.status !== 'pending') {
      await supabase.storage.from(VISUAL_QA_BUCKET).remove([visualQaPendingPath(jobId)])
      continue
    }
    if (await isWordAlreadyRunning()) {
      await heartbeat('waiting:word-in-use')
      break
    }
    await processJob(job)
    processed++
  }
  return processed
}

// A single stuck/failed job already fails closed on its own (processJob's
// own try/catch marks it 'failed' and clears its pending marker via
// failVisualQaJob, so it is never retried in a tight loop). What was NOT
// covered: a transient failure in the polling machinery itself — a
// heartbeat upload hiccup, a Supabase list() call blip, anything thrown
// outside processJob's own try/catch — was left to escape this loop
// entirely and reach the outer main().catch() below, which exits the whole
// --watch process. On this machine that means depending on Task
// Scheduler's fixed 5-attempts/1-minute-apart RestartOnFailure budget to
// resurrect the worker; if the underlying contention (e.g. another process
// also using Word) outlasts that ~5 minute budget, the worker stops for
// good until someone notices and restarts it by hand — exactly what
// happened during this investigation. Catching per-iteration failures here
// keeps the --watch loop itself alive indefinitely; only a truly fatal,
// uncatchable failure (not a network blip, not one hung render) should
// ever reach the outer handler now.
async function runOnce(): Promise<void> {
  await heartbeat('idle')
  await processPending()
}

async function main(): Promise<void> {
  do {
    try {
      await runOnce()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('Worker iteration failed; will retry on the next poll:', message)
      try { await heartbeat(`error:${message}`) } catch { /* best effort */ }
    }
    if (WATCH) await new Promise((resolvePromise) => setTimeout(resolvePromise, POLL_MS))
  } while (WATCH)
}

main().catch(async (error) => {
  // Only reachable for a single-shot (-Once) run, or a failure inside this
  // catch/backoff scaffolding itself — the --watch loop above no longer
  // propagates ordinary per-iteration failures here.
  console.error(error)
  try { await heartbeat(`error:${String(error)}`) } catch { /* best effort */ }
  process.exit(1)
})
