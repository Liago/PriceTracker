export interface ImportStatus {
  id: string
  status: 'pending' | 'running' | 'done' | 'failed'
  result?: Record<string, unknown>
  error?: Record<string, unknown> & { status?: number; error?: string }
}

/** Polling keeps each HTTP request short; the job survives a closed connection. */
export async function waitForImport(
  id: string,
  read: (id: string) => Promise<ImportStatus>,
  { delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)), maxPolls = 180 } = {},
): Promise<ImportStatus> {
  for (let attempt = 0; attempt < maxPolls; attempt++) {
    const job = await read(id)
    if (job.status === 'done' || job.status === 'failed') return job
    await delay(2000)
  }
  throw new Error('Il controllo continua in background. Riprova con lo stesso link per consultarne l’esito.')
}
